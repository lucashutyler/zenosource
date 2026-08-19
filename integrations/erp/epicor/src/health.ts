import type { EpicorClient } from "./client";
import type { EpicorConfig } from "./config";
import { EpicorError, classifyHttpFailure } from "./errors";
import { CAPABILITY_PROBES, endpointFor } from "./bo/endpoints";
import type { HealthFailureKind, HealthReport } from "./types";

// Connection health, and capability verification, in one pass.
//
// They are the same pass on purpose. An Epicor API key is tied to an Access
// Scope that grants specific services, so "is this connection working" and
// "which of the four things can it actually do" have the same answer shape:
// probe each service and see. A partial grant — supplier and PO access but no
// POSuggSvc — is the normal case at a real customer, not an edge case, and
// treating it as all-or-nothing either blocks a working connection or unlocks
// a PO Suggestions screen that is empty forever.

type ProbeOutcome =
  | { capability: string; ok: true }
  | { capability: string; ok: false; kind: HealthFailureKind; confident: boolean; detail: string };

export async function checkHealth(
  client: EpicorClient,
  config: EpicorConfig,
  declaredCapabilities: readonly string[]
): Promise<HealthReport> {
  const outcomes: ProbeOutcome[] = [];

  for (const capability of declaredCapabilities) {
    const key = CAPABILITY_PROBES[capability];
    if (!key) continue;
    const endpoint = endpointFor(key, config as unknown as Record<string, unknown>);
    const url = client.url(endpoint.service, endpoint.resource, { $top: 1 });
    try {
      const result = await client.probe(url);
      if (result.status >= 200 && result.status < 300) {
        outcomes.push({ capability, ok: true });
        continue;
      }
      const { kind, confident } = classifyHttpFailure(result.status, result.body, result.headers);
      outcomes.push({
        capability,
        ok: false,
        kind,
        confident,
        detail: `${endpoint.service}: HTTP ${result.status}`,
      });
    } catch (error) {
      const kind = error instanceof EpicorError ? error.kind : "UNREACHABLE";
      outcomes.push({
        capability,
        ok: false,
        kind,
        confident: true,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (outcomes.length === 0) {
    return {
      healthy: false,
      failure: "CONFIGURATION",
      detail: "No probeable capabilities were declared for this integration.",
    };
  }

  const verified = outcomes.filter((o) => o.ok).map((o) => o.capability);

  // Any service answering means both credentials are good. A partial grant is
  // a healthy connection with a narrower capability set, and the integrations
  // page says which services the key can't reach so an admin can widen the
  // Access Scope if they meant to.
  if (verified.length > 0) {
    const denied = outcomes.filter((o): o is Extract<ProbeOutcome, { ok: false }> => !o.ok);
    return {
      healthy: true,
      failure: "NONE",
      verifiedCapabilities: verified,
      detail:
        denied.length > 0
          ? `Connected. Not available to this API key's Access Scope: ${denied
              .map((d) => d.detail)
              .join(", ")}.`
          : undefined,
    };
  }

  // Nothing answered. Now the failure mode has to be named correctly, because
  // it decides which screen a buyer's IT admin opens.
  const failures = outcomes.filter((o): o is Extract<ProbeOutcome, { ok: false }> => !o.ok);
  const kinds = new Set(failures.map((f) => f.kind));

  if (kinds.size === 1 && failures[0].confident) {
    return {
      healthy: false,
      failure: failures[0].kind,
      detail: describe(failures[0].kind, failures[0].detail),
      verifiedCapabilities: [],
    };
  }

  // Ambiguous — a bare 401 with no marker text, or different services
  // disagreeing. Guessing here is what produces "auth failed", so ask a
  // question that has only one possible answer instead.
  const disambiguated = await disambiguateAuthFailure(client, config, failures[0]);
  return {
    healthy: false,
    failure: disambiguated.kind,
    detail: describe(disambiguated.kind, disambiguated.detail),
    verifiedCapabilities: [],
  };
}

/**
 * Kinetic's gateway checks the API key *before* authentication runs. That
 * ordering is the whole trick: re-send the same request with the identity
 * header deliberately removed.
 *
 * - Still the same rejection → the request never reached authentication, so
 *   it is the key being refused. API_KEY.
 * - A different rejection → the key got us to the authentication layer, and
 *   the original failure was therefore the identity. IDENTITY.
 *
 * One extra request, and it converts a coin-flip into an answer.
 */
async function disambiguateAuthFailure(
  client: EpicorClient,
  config: EpicorConfig,
  original: Extract<ProbeOutcome, { ok: false }>
): Promise<{ kind: HealthFailureKind; detail: string }> {
  if (original.kind === "UNREACHABLE" || original.kind === "CONFIGURATION") {
    return { kind: original.kind, detail: original.detail };
  }

  const key = CAPABILITY_PROBES[original.capability];
  const endpoint = endpointFor(key, config as unknown as Record<string, unknown>);
  const url = client.url(endpoint.service, endpoint.resource, { $top: 1 });

  try {
    const withoutIdentity = await client.probe(url, { includeIdentity: false });
    const anonymous = classifyHttpFailure(
      withoutIdentity.status,
      withoutIdentity.body,
      withoutIdentity.headers
    );
    if (anonymous.kind === "API_KEY" && anonymous.confident) {
      return { kind: "API_KEY", detail: original.detail };
    }
    // Dropping the identity produced an identity-shaped rejection, which
    // means the key itself was getting through. The original failure was the
    // credential behind it.
    return { kind: "IDENTITY", detail: original.detail };
  } catch {
    // The probe itself failed; fall back to the original best guess rather
    // than reporting a second, unrelated problem.
    return { kind: original.kind, detail: original.detail };
  }
}

/** Operator-facing wording. Names the screen, because that's the actual fix. */
function describe(kind: HealthFailureKind, detail: string): string {
  switch (kind) {
    case "API_KEY":
      return `Epicor rejected the API key. Check it in Security > API Key Maintenance, and confirm its Access Scope covers the Erp.BO services ZenoSource reads. (${detail})`;
    case "IDENTITY":
      return `The API key was accepted but the sign-in credential was not. Check the service account's user name and password — the API key itself does not need changing. (${detail})`;
    case "UNREACHABLE":
      return `Could not reach the Epicor server. Nothing is wrong with the credentials; check the URL, the network route and whether Kinetic is up. (${detail})`;
    case "CONFIGURATION":
      return `Reached Epicor and signed in, but the services ZenoSource needs were not found there. Check the Company ID and the server URL. (${detail})`;
    default:
      return detail;
  }
}
