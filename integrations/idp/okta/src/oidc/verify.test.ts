import { describe, it, expect, beforeEach } from "vitest";
import { SignJWT } from "jose";
import { beginSignIn, completeSignIn, accessTokenHash, codeChallengeFor } from "./verify";
import { resetJwksCache } from "./jwks";
import { createFakeOkta } from "../testing/fake-okta";
import type { OktaConfig, OktaSecrets } from "../config";
import type { SignInCallback, SignInExpectations } from "../types";

const CALLBACK = "https://app.zenosource.test/api/sso/acme/callback";

let fake: ReturnType<typeof createFakeOkta>;
let config: OktaConfig;
const secrets: OktaSecrets = { clientSecret: "zenosource-dev-secret" };

beforeEach(() => {
  // A distinct issuer and a cleared cache per spec, so one test's keys can
  // never answer another's.
  resetJwksCache();
  fake = createFakeOkta({ issuer: `https://acme-${Math.random().toString(36).slice(2)}.okta.test/oauth2/default` });
  config = { protocol: "OIDC", issuer: fake.issuer, clientId: fake.clientId };
});

async function roundTrip(overrides?: { user?: (typeof fake.users)[number] }) {
  const started = await beginSignIn(fake.fetchImpl, config, {
    callbackUrl: CALLBACK,
    handle: "handle-abc",
  });
  const { code, state } = fake.authorize(started.url, overrides);
  const callback: SignInCallback = {
    method: "GET",
    url: CALLBACK,
    params: { code, state },
  };
  const expectations: SignInExpectations = {
    callbackUrl: CALLBACK,
    serviceProviderRef: fake.clientId,
    expectedRequestId: started.requestId,
    expectedNonce: started.nonce,
    codeVerifier: started.codeVerifier,
    handle: "handle-abc",
  };
  return { started, callback, expectations };
}

describe("starting a sign-in", () => {
  it("always asks for PKCE with S256, and the challenge matches the verifier it kept", async () => {
    const started = await beginSignIn(fake.fetchImpl, config, {
      callbackUrl: CALLBACK,
      handle: "handle-abc",
    });
    const url = new URL(started.url);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe(codeChallengeFor(started.codeVerifier!));
    // Anything interpretable as a URL in this slot is an open redirect.
    expect(url.searchParams.get("state")).toBe("handle-abc");
  });

  it("puts a fresh nonce on every request", async () => {
    const first = await beginSignIn(fake.fetchImpl, config, { callbackUrl: CALLBACK, handle: "a" });
    const second = await beginSignIn(fake.fetchImpl, config, { callbackUrl: CALLBACK, handle: "b" });
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });
});

describe("a valid sign-in", () => {
  it("returns the person the token is about", async () => {
    const { callback, expectations } = await roundTrip();
    const result = await completeSignIn(fake.fetchImpl, config, secrets, callback, expectations);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity.email).toBe("buyer@acme.test");
    expect(result.identity.subject).toBe("00uSEEDBUYER");
    expect(result.identity.groupRefs).toEqual(["Procurement"]);
  });

  it("exchanges the code on the back channel, never in the browser", async () => {
    const { callback, expectations } = await roundTrip();
    await completeSignIn(fake.fetchImpl, config, secrets, callback, expectations);
    expect(fake.calls.some((c) => c.method === "POST" && c.url.endsWith("/v1/token"))).toBe(true);
  });
});

describe("token verification", () => {
  it("refuses a token signed with an algorithm we do not accept", async () => {
    const { callback, expectations } = await roundTrip();
    const forged = await new SignJWT({ sub: "attacker", email: ATTACKER, nonce: expectations.expectedNonce })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(fake.issuer)
      .setAudience(fake.clientId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("zenosource-dev-secret".padEnd(32, "!")));
    fake.serveNextIdToken(forged);

    const result = await completeSignIn(fake.fetchImpl, config, secrets, callback, expectations);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("UNTRUSTED");
  });

  it("refuses an unsigned token claiming alg none", async () => {
    const { callback, expectations } = await roundTrip();
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: fake.issuer,
        aud: fake.clientId,
        sub: "attacker",
        email: ATTACKER,
        nonce: expectations.expectedNonce,
        exp: Math.floor(Date.now() / 1000) + 300,
      })
    ).toString("base64url");
    fake.serveNextIdToken(`${header}.${payload}.`);

    const result = await completeSignIn(fake.fetchImpl, config, secrets, callback, expectations);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("UNTRUSTED");
  });

  it("refuses a token signed by a key the identity provider does not publish", async () => {
    const { callback, expectations } = await roundTrip();
    const other = createFakeOkta({ issuer: fake.issuer, clientId: fake.clientId });
    fake.serveNextIdToken(
      await other.signIdToken({
        sub: "attacker",
        email: ATTACKER,
        nonce: expectations.expectedNonce,
      })
    );
    const result = await completeSignIn(fake.fetchImpl, config, secrets, callback, expectations);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("UNTRUSTED");
  });

  it("names the missing scope when a token carries no email", async () => {
    const { callback, expectations } = await roundTrip();
    fake.serveNextIdToken(
      await fake.signIdToken({ sub: "00uSEEDBUYER", nonce: expectations.expectedNonce })
    );
    const result = await completeSignIn(fake.fetchImpl, config, secrets, callback, expectations);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("MISCONFIGURED");
    expect(result.detail).toMatch(/email/i);
  });

  it("refuses a token whose access-token binding does not match", async () => {
    const { callback, expectations } = await roundTrip();
    fake.serveNextIdToken(
      await fake.signIdToken({
        sub: "00uSEEDBUYER",
        email: "buyer@acme.test",
        nonce: expectations.expectedNonce,
        at_hash: accessTokenHash("a-different-access-token"),
      })
    );
    const result = await completeSignIn(fake.fetchImpl, config, secrets, callback, expectations);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("UNTRUSTED");
  });

  it("refuses a token minted for another tenant's application", async () => {
    const { callback, expectations } = await roundTrip();
    const result = await completeSignIn(
      fake.fetchImpl,
      config,
      secrets,
      callback,
      expectations
    );
    expect(result.ok).toBe(true);

    const other = await roundTrip();
    const crossed = await completeSignIn(
      fake.fetchImpl,
      { ...config, clientId: "0oaSOMEBODYELSE" },
      secrets,
      other.callback,
      other.expectations
    );
    expect(crossed.ok).toBe(false);
  });

  it("refuses a token answering a different sign-in request", async () => {
    const { callback, expectations } = await roundTrip();
    const result = await completeSignIn(fake.fetchImpl, config, secrets, callback, {
      ...expectations,
      expectedNonce: "a-nonce-from-somebody-elses-request",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/different sign-in request/i);
  });

  it("refuses a callback with no stored proof of possession", async () => {
    const { callback, expectations } = await roundTrip();
    const result = await completeSignIn(fake.fetchImpl, config, secrets, callback, {
      ...expectations,
      codeVerifier: null,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a code exchanged with the wrong verifier", async () => {
    const { callback, expectations } = await roundTrip();
    const result = await completeSignIn(fake.fetchImpl, config, secrets, callback, {
      ...expectations,
      codeVerifier: "a-verifier-that-was-never-committed-to",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a code that has already been exchanged", async () => {
    const { callback, expectations } = await roundTrip();
    const first = await completeSignIn(fake.fetchImpl, config, secrets, callback, expectations);
    expect(first.ok).toBe(true);
    const replay = await completeSignIn(fake.fetchImpl, config, secrets, callback, expectations);
    expect(replay.ok).toBe(false);
  });

  it("refuses a wrong client secret as a setup problem, not a rejected person", async () => {
    const { callback, expectations } = await roundTrip();
    const result = await completeSignIn(
      fake.fetchImpl,
      config,
      { clientSecret: "not-the-secret" },
      callback,
      expectations
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // REJECTED would leave a broken connection looking healthy while nobody
    // could sign in.
    expect(result.kind).toBe("MISCONFIGURED");
  });

  it("ignores any token arriving in the redirect itself", async () => {
    const { callback, expectations } = await roundTrip();
    const forged = await fake.signIdToken({ sub: "attacker", email: ATTACKER });
    const result = await completeSignIn(
      fake.fetchImpl,
      config,
      secrets,
      { ...callback, params: { ...callback.params, id_token: forged } },
      expectations
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity.email).toBe("buyer@acme.test");
  });

  it("reports a cancelled sign-in as a rejection, leaving the connection alone", async () => {
    const result = await completeSignIn(
      fake.fetchImpl,
      config,
      secrets,
      { method: "GET", url: CALLBACK, params: { error: "access_denied", state: "handle-abc" } },
      {
        callbackUrl: CALLBACK,
        serviceProviderRef: fake.clientId,
        expectedRequestId: "handle-abc",
        handle: "handle-abc",
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("REJECTED");
  });
});

const ATTACKER = "attacker@evil.test";

describe("the access-token binding", () => {
  it("computes the left half of the SHA-256, base64url", () => {
    expect(accessTokenHash("abc")).toBe("ungWv48Bz-pBQUDeXa4iIw");
  });
});
