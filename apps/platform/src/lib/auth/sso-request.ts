import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { safeReturnTo } from "./return-to";
import type { SsoProtocol } from "@/generated/prisma/enums";

// One in-flight sign-in, and the two things that have to agree before it
// counts.
//
// A response arriving at the callback has to prove two separate facts: that we
// asked the question, and that the browser answering is the browser that
// asked. Neither mechanism alone does both:
//
//   * A server-side row can be made single-use atomically, but a row says
//     nothing about *whose* browser is presenting the answer — so anyone who
//     obtains a handle could finish somebody else's sign-in in their own
//     browser and be signed in as them.
//   * A cookie binds the browser, but cannot be made single-use across more
//     than one running instance. And src/lib/session.ts sets `sameSite: "lax"`
//     for good reasons; a Lax cookie is *not* sent on the cross-site POST that
//     a SAML response arrives as. A cookie-only design therefore works for one
//     protocol and silently fails for the other.
//
// So: both, and both must agree. The row is consumed by a single atomic
// statement — the same shape src/lib/document-number.ts uses and documents,
// where the read and the write are one statement rather than a read-then-write
// race — and the cookie's hash on that row is checked against the cookie the
// browser presented.

export const SSO_COOKIE = "zs_sso";

/** Long enough for a slow identity provider and a person reading a prompt. */
const TTL_MS = 10 * 60_000;

/** How long a consumed or expired row is kept before being swept. */
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
 * Minted before the connector runs, so the connector can put it in the
 * protocol's own round-trip slot itself. The alternative — letting the
 * connector build a URL and rewriting the parameter afterwards — means the
 * platform naming a wire parameter, which is exactly what idp-contract.ts
 * exists to prevent, and it breaks silently the day a protocol spells that
 * slot differently.
 *
 * 32 random bytes, carrying no meaning. There is therefore no code path in
 * which a value an identity provider echoes back can be interpreted as a URL,
 * which is what makes an open redirect structurally impossible here rather
 * than defended against.
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

  // Swept here rather than on the way back: the callback is the leg a person
  // is waiting on, and a housekeeping delete has no business adding to it.
  // There is no scheduler until Phase 6 (docs/todo.md), so this is where it
  // has to live.
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
 * Claim a request, exactly once.
 *
 * The `consumedAt IS NULL` predicate is inside the UPDATE, so two simultaneous
 * callbacks carrying the same handle cannot both come back with a row — one
 * gets it, the other gets nothing. A read-then-write would let both through
 * on a bad afternoon, and "both" here means an authorization code replayed.
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
  // makes a stolen handle worth nothing even to the thief who presents it
  // with the wrong browser.
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
