import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { hint } from "@/lib/integrations/secrets";
import type { PrismaClient } from "@/generated/prisma/client";

const PREFIX = "zs_dir_";

// Hashed rather than sealed: a fresh IV per value cannot be looked up by what is presented.
function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type IssuedToken = {
  id: string;
  plaintext: string;
  tokenHint: string;
};

export async function issueDirectoryToken(params: {
  tenantId: string;
  connectionId: string;
  name: string;
  createdByUserId?: string | null;
}): Promise<IssuedToken> {
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

export function bearerFrom(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

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

  // Equal by construction today; the check must hold if the lookup is ever loosened.
  const presentedDigest = Buffer.from(digest(presented), "utf8");
  const stored = Buffer.from(row.tokenHash, "utf8");
  if (presentedDigest.length !== stored.length || !timingSafeEqual(presentedDigest, stored)) {
    return null;
  }

  // DEGRADED still provisions: a health probe must not block deprovisioning somebody who left.
  if (row.connection.status === "DISCONNECTED") return null;

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
