import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { safeReturnTo } from "./return-to";
import type { SsoProtocol } from "@/generated/prisma/enums";

export const SSO_COOKIE = "zs_sso";

const TTL_MS = 10 * 60_000;

const RETENTION_MS = 24 * 60 * 60_000;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type StartedRequest = {
  handle: string;
  cookieValue: string;
  expiresAt: Date;
};

export function newHandle(): string {
  return randomBytes(32).toString("base64url");
}

export async function beginRequest(params: {
  handle: string;
  tenantId: string;
  integrationId: string;
  protocol: SsoProtocol;
  requestId: string;
  nonce?: string | null;
  codeVerifier?: string | null;
  redirectTo?: string | null;
}): Promise<StartedRequest> {
  const handle = params.handle;
  const cookieValue = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS);

  await db.ssoAuthRequest.create({
    data: {
      tenantId: params.tenantId,
      integrationId: params.integrationId,
      protocol: params.protocol,
      handle,
      requestId: params.requestId,
      nonce: params.nonce ?? null,
      codeVerifier: params.codeVerifier ?? null,
      browserBindingHash: sha256(cookieValue),
      redirectTo: safeReturnTo(params.redirectTo),
      expiresAt,
    },
  });

  await db.ssoAuthRequest
    .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - RETENTION_MS) } } })
    .catch(() => undefined);

  return { handle, cookieValue, expiresAt };
}

export type ConsumedRequest = {
  id: string;
  tenantId: string;
  integrationId: string;
  protocol: SsoProtocol;
  handle: string;
  requestId: string;
  nonce: string | null;
  codeVerifier: string | null;
  redirectTo: string;
};

// The single-use claim must stay inside the UPDATE: a read-then-write replays a credential.
export async function consumeRequest(
  handle: string,
  cookieValue: string | undefined
): Promise<ConsumedRequest | null> {
  if (!handle || !cookieValue) return null;

  const rows = await db.$queryRaw<ConsumedRequest[]>`
    UPDATE "SsoAuthRequest"
       SET "consumedAt" = NOW()
     WHERE "handle" = ${handle}
       AND "consumedAt" IS NULL
       AND "expiresAt" > NOW()
    RETURNING "id", "tenantId", "integrationId", "protocol", "handle",
              "requestId", "nonce", "codeVerifier", "redirectTo"
  `;
  const row = rows[0];
  if (!row) return null;

  const presented = Buffer.from(sha256(cookieValue), "utf8");
  const stored = await db.ssoAuthRequest.findUnique({
    where: { id: row.id },
    select: { browserBindingHash: true },
  });
  if (!stored) return null;
  const expected = Buffer.from(stored.browserBindingHash, "utf8");
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;

  return row;
}
