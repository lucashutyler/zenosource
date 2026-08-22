import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { hint } from "@/lib/integrations/secrets";
import type { PrismaClient } from "@/generated/prisma/client";

// The bearer a customer's directory authenticates with.
//
// docs/integrations.md: "each tenant's Okta connection gets its own SCIM
// bearer token, and that token *is* the tenant boundary: a bug that lets one
// tenant's SCIM token touch another tenant's users is a severe multi-tenancy
// breach, not just a permissions bug."
//
// Hashed, not sealed, and the reason is the direction of use.
// src/lib/integrations/secrets.ts is reversible because an ERP credential has
// to be *replayed* outbound; this one is only ever *verified*, and a seal with
// a fresh IV per value cannot be looked up by the value somebody presents —
// authenticating a push would mean decrypting every row on every request.
// bcrypt is the wrong tool for the opposite reason: this is 32 bytes of
// entropy rather than something a human chose, so there is nothing for a work
// factor to defend, and ~100ms per request across a bulk import is a timeout.
//
// Several live tokens per connection, on purpose. Rotation should overlap —
// issue the new one, change it at the directory's end, revoke the old — rather
// than needing a cutover with a window in which offboarding does not work.

const PREFIX = "zs_dir_";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type IssuedToken = {
  id: string;
  /** Returned once, at issue, and never recoverable afterwards. */
  plaintext: string;
  tokenHint: string;
};

export async function issueDirectoryToken(params: {
  tenantId: string;
  connectionId: string;
  name: string;
  createdByUserId?: string | null;
}): Promise<IssuedToken> {
  // The prefix is deliberate: a value that leaks into a log or a paste is
  // recognisable as a ZenoSource directory credential by whoever finds it,
  // which is the difference between a revoked token and an unnoticed one.
  const plaintext = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  const token = await db.directoryToken.create({
    data: {
      tenantId: params.tenantId,
      connectionId: params.connectionId,
      name: params.name,
      tokenHash: digest(plaintext),
      tokenHint: hint(plaintext),
      createdByUserId: params.createdByUserId ?? null,
    },
  });
  return { id: token.id, plaintext, tokenHint: token.tokenHint };
}

export type ResolvedDirectoryToken = {
  tokenId: string;
  tenantId: string;
  connectionId: string;
};

/** `Authorization: Bearer …`, or nothing. */
export function bearerFrom(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Authenticate an inbound directory request.
 *
 * Every failure returns `null` and the caller answers with the same 401 —
 * unknown token, revoked token, malformed header, disconnected integration.
 * Distinguishing them would tell whoever is probing which of the four they
 * achieved, and none of the four is something a legitimate client needs to
 * tell apart.
 */
export async function resolveDirectoryToken(
  presented: string | null,
  client: PrismaClient = db
): Promise<ResolvedDirectoryToken | null> {
  if (!presented) return null;

  const row = await client.directoryToken.findUnique({
    where: { tokenHash: digest(presented) },
    select: {
      id: true,
      tenantId: true,
      connectionId: true,
      tokenHash: true,
      revokedAt: true,
      connection: { select: { status: true } },
    },
  });
  if (!row || row.revokedAt) return null;

  // The unique index already found it by exact hash, so this compares equal
  // by construction. Kept as the belt to the index's braces: if the lookup is
  // ever loosened — a prefix scan, a case-insensitive collation — this is the
  // check that still has to pass, and it is constant-time.
  const presentedDigest = Buffer.from(digest(presented), "utf8");
  const stored = Buffer.from(row.tokenHash, "utf8");
  if (presentedDigest.length !== stored.length || !timingSafeEqual(presentedDigest, stored)) {
    return null;
  }

  // DEGRADED still provisions. A certificate expiring, or a health probe
  // failing, must not stop a customer deprovisioning somebody who has left —
  // that is the moment when provisioning matters most, and the leaver's
  // session is live for up to seven days. DISCONNECTED does stop it: turning
  // an integration off is a decision, and connections.ts revokes these tokens
  // as part of it anyway.
  if (row.connection.status === "DISCONNECTED") return null;

  // Best-effort, and never allowed to fail the request: this is a
  // "when did this last work" convenience on the settings page, not part of
  // authenticating anything.
  void client.directoryToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return { tokenId: row.id, tenantId: row.tenantId, connectionId: row.connectionId };
}

export async function revokeDirectoryToken(tokenId: string, tenantId: string): Promise<void> {
  await db.directoryToken.updateMany({
    where: { id: tokenId, tenantId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Called by `disconnect()`. Its own comment says disconnecting exists so that
 * "a disconnected integration stops being a credential at rest" — a live
 * directory token that could still deactivate users would break that promise
 * in the one direction that matters.
 */
export async function revokeAllForConnection(
  connectionId: string,
  client: PrismaClient = db
): Promise<number> {
  const result = await client.directoryToken.updateMany({
    where: { connectionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
