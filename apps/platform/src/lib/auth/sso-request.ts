import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { safeReturnTo } from "./return-to";
import type { SsoProtocol } from "@/generated/prisma/enums";

// A single-use row and a browser-bound cookie must both agree: a row binds no
// browser, and a Lax cookie is not sent on the cross-site POST that a SAML
// response arrives as, so neither mechanism alone works for both protocols.

export const SSO_COOKIE = "zs_sso";

const TTL_MS = 10 * 60_000;

const RETENTION_MS = 24 * 60 * 60_000;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type StartedRequest = {
  handle: string;
  /** Set as a short-lived cookie. Never stored anywhere but the browser. */
  cookieValue: string;
  expiresAt: Date;
};

/**
 * Minted before the connector runs, so the connector puts it in the protocol's
 * own round-trip slot. 32 random bytes carrying no meaning, so nothing an
 * identity provider echoes back can be interpreted as a URL.
 */
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

  // Swept on the way out rather than on the callback leg a person is waiting
  // on. There is no scheduler yet.
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

/**
 * Claim a request, exactly once: the `consumedAt IS NULL` predicate is inside
 * the UPDATE, so two simultaneous callbacks carrying the same handle cannot
 * both come back with a row. A read-then-write would replay a credential.
 */
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

  // The row is already spent whether or not this check passes, which is what
  // makes a stolen handle worth nothing in the wrong browser.
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
