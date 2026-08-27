import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { hint } from "@/lib/integrations/secrets";
import type { PrismaClient } from "@/generated/prisma/client";

// Hashed rather than sealed: this is only ever verified, never replayed, and a
// seal with a fresh IV per value cannot be looked up by what somebody presents.
// bcrypt defends nothing on 32 random bytes and costs ~100ms per request.
//
// Several live tokens per connection, so rotation can overlap.

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
  // The prefix makes a leaked value recognisable as a ZenoSource directory
  // credential by whoever finds it.
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
 * Authenticate an inbound directory request. Every failure returns `null` and
 * the caller answers the same 401 — distinguishing an unknown token from a
 * revoked one tells whoever is probing which of them they achieved.
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

  // Equal by construction today; the constant-time check that still has to
  // hold if the lookup is ever loosened to a prefix scan or a loose collation.
  const presentedDigest = Buffer.from(digest(presented), "utf8");
  const stored = Buffer.from(row.tokenHash, "utf8");
  if (presentedDigest.length !== stored.length || !timingSafeEqual(presentedDigest, stored)) {
    return null;
  }

  // DEGRADED still provisions: a failing health probe must not stop a customer
  // deprovisioning somebody who has left, whose session is live for up to seven
  // days. DISCONNECTED does stop it — turning an integration off is a decision.
  if (row.connection.status === "DISCONNECTED") return null;

  // Best-effort, and never allowed to fail the request: a convenience on the
  // settings page, not part of authenticating anything.
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
 * Called by `disconnect()` — a live directory token could otherwise still
 * deactivate users after an integration is turned off.
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
