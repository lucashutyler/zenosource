import type { HealthFailureKind } from "./types";

/**
 * Every failure this connector produces, classified into one of the kinds the
 * platform can act on.
 *
 * The classification is the point, not a nicety. docs/integrations.md#epicor-erp:
 * "Missing either fails differently — the connection-health check and
 * onboarding flow need to distinguish the two failure modes, not report one
 * generic 'auth failed.'" The two credentials are held by different people
 * and fixed in different screens — an API key is regenerated in Security >
 * API Key Maintenance, an identity is a service account in AD or Epicor user
 * maintenance — so "auth failed" sends a buyer's IT admin to the wrong place
 * roughly half the time.
 */
export class EpicorError extends Error {
  constructor(
    message: string,
    readonly kind: HealthFailureKind,
    readonly status?: number,
    readonly body?: string
  ) {
    super(message);
    this.name = "EpicorError";
  }
}

// Kinetic's API gateway validates the API key *before* authentication runs,
// so a bad key and a bad password come back at different layers and say
// different things. These are the markers each layer leaves. Matching on
// message text is admittedly brittle across Kinetic versions, which is why
// health.ts does not rely on it alone — when the text is unfamiliar it runs a
// disambiguating probe instead of guessing.
const API_KEY_MARKERS = [
  "api key",
  "apikey",
  "api-key",
  "x-api-key",
  "access scope",
  "subscription key",
];

const IDENTITY_MARKERS = [
  "invalid_client",
  "invalid_grant",
  "authentication failed",
  "invalid credentials",
  "user name or password",
  "account is locked",
  "password has expired",
];

export type ClassifiedResponse = {
  kind: HealthFailureKind;
  /** False when the markers were absent and the kind is a best guess. */
  confident: boolean;
};

export function classifyHttpFailure(
  status: number,
  body: string,
  headers?: { get(name: string): string | null }
): ClassifiedResponse {
  const haystack = body.toLowerCase();

  if (status === 401 || status === 403) {
    if (API_KEY_MARKERS.some((m) => haystack.includes(m))) {
      return { kind: "API_KEY", confident: true };
    }
    if (IDENTITY_MARKERS.some((m) => haystack.includes(m))) {
      return { kind: "IDENTITY", confident: true };
    }
    // A `WWW-Authenticate` challenge means the gateway let us through and the
    // *application* is asking who we are — the key was accepted. Good signal
    // when it's present; absent from plenty of responses, so not required.
    if (headers?.get("www-authenticate")) {
      return { kind: "IDENTITY", confident: true };
    }
    // Ambiguous. 401 leans identity and 403 leans scope/key, but neither is
    // reliable enough to tell an admin which screen to open — health.ts
    // probes rather than shipping this guess to a user.
    return { kind: status === 403 ? "API_KEY" : "IDENTITY", confident: false };
  }

  if (status === 404) {
    // Reachable and authenticated, pointed at something that isn't there: a
    // wrong company id, a wrong base URL, or a BO this instance doesn't
    // expose. All three are configuration, and none is fixed by new
    // credentials.
    return { kind: "CONFIGURATION", confident: true };
  }

  if (status >= 500) {
    // Their server, not our credentials. Re-entering a password here is
    // wasted effort, so it must not be presented as an auth problem.
    return { kind: "UNREACHABLE", confident: true };
  }

  if (status === 429) {
    return { kind: "UNREACHABLE", confident: true };
  }

  return { kind: "CONFIGURATION", confident: false };
}

/** Network-layer failures: DNS, TLS, timeout, connection refused. */
export function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return (
    name === "aborterror" ||
    name === "timeouterror" ||
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("etimedout") ||
    message.includes("certificate") ||
    message.includes("network")
  );
}
