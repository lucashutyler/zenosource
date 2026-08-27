import { jwtVerify, decodeProtectedHeader } from "jose";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { discover, type OidcMetadata } from "./discovery";
import { jwksFor } from "./jwks";
import type {
  FederatedIdentity,
  FetchLike,
  SignInCallback,
  SignInExpectations,
  SignInRedirect,
  SignInResult,
} from "../types";
import type { OktaConfig, OktaSecrets } from "../config";

export const CLOCK_SKEW_SECONDS = 60;

const ALLOWED_ALGORITHMS = ["RS256"] as const;

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function createCodeVerifier(): string {
  return base64url(randomBytes(32));
}

export function codeChallengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier, "ascii").digest());
}

export function accessTokenHash(accessToken: string): string {
  const digest = createHash("sha256").update(accessToken, "ascii").digest();
  return base64url(digest.subarray(0, digest.length / 2));
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function beginSignIn(
  fetchImpl: FetchLike,
  config: OktaConfig,
  params: { callbackUrl: string; handle: string; loginHint?: string | null }
): Promise<SignInRedirect> {
  const discovery = await discover(fetchImpl, config.issuer ?? "");
  if (!discovery.ok) {
    throw new Error(discovery.detail);
  }
  const codeVerifier = createCodeVerifier();
  const nonce = base64url(randomBytes(32));
  const url = new URL(discovery.metadata.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId ?? "");
  url.searchParams.set("redirect_uri", params.callbackUrl);
  url.searchParams.set("scope", "openid email profile groups");
  url.searchParams.set("state", params.handle);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallengeFor(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  if (params.loginHint) url.searchParams.set("login_hint", params.loginHint);

  return {
    url: url.toString(),
    requestId: params.handle,
    nonce,
    codeVerifier,
  };
}

type TokenResponse = {
  access_token?: string;
  id_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

async function exchangeCode(
  fetchImpl: FetchLike,
  metadata: OidcMetadata,
  config: OktaConfig,
  secrets: OktaSecrets,
  params: { code: string; codeVerifier: string; redirectUri: string }
): Promise<{ ok: true; tokens: TokenResponse } | { ok: false; result: SignInResult }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    client_id: config.clientId ?? "",
  });

  const basic = Buffer.from(
    `${encodeURIComponent(config.clientId ?? "")}:${encodeURIComponent(secrets.clientSecret ?? "")}`,
    "utf8"
  ).toString("base64");

  let response: Response;
  try {
    response = await fetchImpl(metadata.tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        authorization: `Basic ${basic}`,
      },
      body: body.toString(),
    });
  } catch (thrown) {
    return {
      ok: false,
      result: {
        ok: false,
        kind: "UNREACHABLE",
        detail: `Could not reach the token endpoint: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      },
    };
  }

  let tokens: TokenResponse;
  try {
    tokens = (await response.json()) as TokenResponse;
  } catch {
    return {
      ok: false,
      result: { ok: false, kind: "UNREACHABLE", detail: "The token endpoint did not return JSON." },
    };
  }

  if (!response.ok || tokens.error) {
    const misconfigured = tokens.error === "invalid_client" || response.status === 401;
    return {
      ok: false,
      result: {
        ok: false,
        kind: misconfigured ? "MISCONFIGURED" : "REJECTED",
        detail: tokens.error_description ?? tokens.error ?? `The token endpoint answered ${response.status}.`,
      },
    };
  }

  if (!tokens.id_token) {
    return {
      ok: false,
      result: { ok: false, kind: "MISCONFIGURED", detail: "The token response carried no ID token." },
    };
  }
  return { ok: true, tokens };
}

export async function completeSignIn(
  fetchImpl: FetchLike,
  config: OktaConfig,
  secrets: OktaSecrets,
  callback: SignInCallback,
  expectations: SignInExpectations
): Promise<SignInResult> {
  const error = callback.params.error;
  if (error) {
    return {
      ok: false,
      kind: error === "access_denied" || error === "login_required" ? "REJECTED" : "MISCONFIGURED",
      detail: callback.params.error_description ?? error,
    };
  }

  const code = callback.params.code;
  if (!code) {
    return { ok: false, kind: "REJECTED", detail: "The sign-in came back without an authorization code." };
  }
  if (!expectations.expectedNonce) {
    return { ok: false, kind: "REJECTED", detail: "That sign-in request is no longer valid." };
  }

  const discovery = await discover(fetchImpl, config.issuer ?? "");
  if (!discovery.ok) {
    return { ok: false, kind: discovery.kind, detail: discovery.detail };
  }

  const codeVerifier = expectations.codeVerifier ?? "";
  if (!codeVerifier) {
    return { ok: false, kind: "REJECTED", detail: "That sign-in request is no longer valid." };
  }

  const exchanged = await exchangeCode(fetchImpl, discovery.metadata, config, secrets, {
    code,
    codeVerifier,
    redirectUri: expectations.callbackUrl,
  });
  if (!exchanged.ok) return exchanged.result;

  const idToken = exchanged.tokens.id_token as string;

  // For an early, clear refusal only: nothing below selects a key or an algorithm from it.
  let headerAlgorithm = "";
  try {
    headerAlgorithm = decodeProtectedHeader(idToken).alg ?? "";
  } catch {
    return { ok: false, kind: "REJECTED", detail: "The ID token is not a well-formed token." };
  }
  if (!(ALLOWED_ALGORITHMS as readonly string[]).includes(headerAlgorithm)) {
    return {
      ok: false,
      kind: "UNTRUSTED",
      detail: `The ID token is signed with ${headerAlgorithm || "no algorithm"}; only RS256 is accepted.`,
    };
  }

  let claims: Record<string, unknown>;
  try {
    const verified = await jwtVerify(idToken, jwksFor(fetchImpl, discovery.metadata.jwksUri), {
      issuer: discovery.metadata.issuer,
      audience: config.clientId ?? "",
      algorithms: [...ALLOWED_ALGORITHMS],
      clockTolerance: CLOCK_SKEW_SECONDS,
    });
    claims = verified.payload as Record<string, unknown>;
  } catch (thrown) {
    const code = (thrown as { code?: string })?.code ?? "";
    const expired = code === "ERR_JWT_EXPIRED";
    return {
      ok: false,
      kind: expired ? "REJECTED" : "UNTRUSTED",
      detail: expired
        ? "That sign-in took too long to come back. Try again."
        : `The ID token did not verify (${code || (thrown instanceof Error ? thrown.message : "unknown")}).`,
    };
  }

  const nonce = typeof claims.nonce === "string" ? claims.nonce : "";
  if (!nonce || !constantTimeEquals(nonce, expectations.expectedNonce)) {
    return {
      ok: false,
      kind: "UNTRUSTED",
      detail: "The ID token answers a different sign-in request than the one that was started.",
    };
  }

  const atHash = typeof claims.at_hash === "string" ? claims.at_hash : "";
  if (atHash) {
    const accessToken = exchanged.tokens.access_token ?? "";
    if (!accessToken || !constantTimeEquals(atHash, accessTokenHash(accessToken))) {
      return {
        ok: false,
        kind: "UNTRUSTED",
        detail: "The ID token is not bound to the access token that arrived with it.",
      };
    }
  }

  const subject = typeof claims.sub === "string" ? claims.sub : "";
  if (!subject) {
    return { ok: false, kind: "UNTRUSTED", detail: "The ID token carries no subject." };
  }

  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email) {
    return {
      ok: false,
      kind: "MISCONFIGURED",
      detail:
        "The ID token carries no email address. Add the `email` scope to the application, and make sure the email claim is included in the ID token.",
    };
  }

  const identity: FederatedIdentity = {
    subject,
    email,
    name:
      (typeof claims.name === "string" && claims.name) ||
      (typeof claims.preferred_username === "string" && claims.preferred_username) ||
      null,
  };
  if (Array.isArray(claims.groups)) {
    identity.groupRefs = claims.groups.filter((g): g is string => typeof g === "string");
  }
  return { ok: true, identity };
}
