import type { FetchLike } from "../types";

export type OidcMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  endSessionEndpoint?: string;
};

export type DiscoveryResult =
  | { ok: true; metadata: OidcMetadata }
  | { ok: false; kind: "UNREACHABLE" | "MISCONFIGURED"; detail: string };

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function secure(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && parsed.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

export async function discover(
  fetchImpl: FetchLike,
  issuer: string
): Promise<DiscoveryResult> {
  const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;

  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (thrown) {
    return {
      ok: false,
      kind: "UNREACHABLE",
      detail: `Could not reach ${issuer}: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      kind: "UNREACHABLE",
      detail: `${issuer} answered ${response.status} for its OpenID configuration.`,
    };
  }

  let document: Record<string, unknown>;
  try {
    document = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, kind: "MISCONFIGURED", detail: `${issuer} did not return JSON.` };
  }

  const read = (key: string): string =>
    typeof document[key] === "string" ? (document[key] as string) : "";

  const declared = read("issuer");
  // Byte-for-byte: a trailing-slash difference is a different issuer to token
  // validation, so accepting it here passes the health check and breaks every sign-in.
  if (declared !== issuer.replace(/\/+$/, "")) {
    return {
      ok: false,
      kind: "MISCONFIGURED",
      detail: `That server calls itself ${declared || "(nothing)"}, not ${issuer}. Use the issuer exactly as it appears there.`,
    };
  }

  const authorizationEndpoint = read("authorization_endpoint");
  const tokenEndpoint = read("token_endpoint");
  const jwksUri = read("jwks_uri");
  for (const [name, value] of [
    ["authorization_endpoint", authorizationEndpoint],
    ["token_endpoint", tokenEndpoint],
    ["jwks_uri", jwksUri],
  ] as const) {
    if (!value) {
      return { ok: false, kind: "MISCONFIGURED", detail: `That server publishes no ${name}.` };
    }
    if (!secure(value)) {
      return { ok: false, kind: "MISCONFIGURED", detail: `Its ${name} is not https://.` };
    }
    // A cross-origin endpoint sends a token request or a key fetch somewhere the
    // admin never named.
    if (!sameOrigin(value, issuer)) {
      return {
        ok: false,
        kind: "MISCONFIGURED",
        detail: `Its ${name} points at a different host than the issuer.`,
      };
    }
  }

  const list = (key: string): string[] =>
    Array.isArray(document[key]) ? (document[key] as unknown[]).filter((v): v is string => typeof v === "string") : [];

  const algorithms = list("id_token_signing_alg_values_supported");
  if (algorithms.length > 0 && !algorithms.includes("RS256")) {
    return {
      ok: false,
      kind: "MISCONFIGURED",
      detail: "That server does not sign ID tokens with RS256, which is the only algorithm accepted here.",
    };
  }

  const challenges = list("code_challenge_methods_supported");
  if (challenges.length > 0 && !challenges.includes("S256")) {
    return {
      ok: false,
      kind: "MISCONFIGURED",
      detail: "That server does not support PKCE with S256, which is required.",
    };
  }

  const responseTypes = list("response_types_supported");
  if (responseTypes.length > 0 && !responseTypes.includes("code")) {
    return {
      ok: false,
      kind: "MISCONFIGURED",
      detail: "That server does not support the authorization-code flow.",
    };
  }

  const metadata: OidcMetadata = {
    issuer: declared,
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
  };
  const endSession = read("end_session_endpoint");
  if (endSession) metadata.endSessionEndpoint = endSession;
  return { ok: true, metadata };
}
