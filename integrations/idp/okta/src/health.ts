import { X509Certificate } from "node:crypto";
import { discover } from "./oidc/discovery";
import type { OktaConfig } from "./config";
import type { FetchLike, HealthReport } from "./types";

// Connection health and capability probing, in one pass — the same shape as
// integrations/erp/epicor/src/health.ts.
//
// What "healthy" means for an identity provider is not what it means for an
// ERP, and the difference is worth stating. There is no service account to
// exercise: nothing here can prove that a real person will be able to sign in,
// because that depends on the customer's own application assignment, which we
// cannot see. What can be proved is that the thing an admin typed exists, is
// who it says it is, and that the material a sign-in will be verified against
// is present and current. Everything else is reported by the sign-in path
// itself, which is the only place that ever sees a real credential.
//
// `scim_provisioning` is always granted on an otherwise-healthy connection,
// and that is deliberate rather than lazy: we are the directory *server*.
// There is nothing outbound to probe, and the token a directory authenticates
// with is issued after this connection exists — so probing it would report a
// capability as absent exactly until someone used it.

export type OktaCapability = "sso_oidc" | "sso_saml" | "scim_provisioning";

/** How close to expiry a certificate has to be before it is worth a sentence. */
export const CERTIFICATE_WARNING_DAYS = 45;

function certificateWindow(
  certificates: string[]
): { ok: true; earliestNotAfter: Date | null } | { ok: false; detail: string } {
  let earliest: Date | null = null;
  let anyCurrent = false;
  const now = Date.now();

  for (const body of certificates) {
    let parsed: X509Certificate;
    try {
      parsed = new X509Certificate(
        `-----BEGIN CERTIFICATE-----\n${body.replace(/(.{64})/g, "$1\n")}\n-----END CERTIFICATE-----`
      );
    } catch {
      return { ok: false, detail: "One of the stored signing certificates can't be read." };
    }
    const notAfter = new Date(parsed.validTo);
    const notBefore = new Date(parsed.validFrom);
    if (Number.isNaN(notAfter.getTime())) {
      return { ok: false, detail: "One of the stored signing certificates has no expiry." };
    }
    if (notBefore.getTime() <= now && notAfter.getTime() > now) {
      anyCurrent = true;
      // The soonest expiry among the certificates that are actually usable
      // now. Reporting the next one's date instead would be a reassurance
      // about a certificate nothing is signing with yet.
      if (!earliest || notAfter < earliest) earliest = notAfter;
    }
  }

  if (!anyCurrent) {
    return {
      ok: false,
      detail:
        "Every stored signing certificate has expired or is not valid yet. Upload the current one from your identity provider.",
    };
  }
  return { ok: true, earliestNotAfter: earliest };
}

export async function checkHealth(
  fetchImpl: FetchLike,
  config: OktaConfig
): Promise<HealthReport> {
  if (config.protocol === "OIDC") {
    const discovery = await discover(fetchImpl, config.issuer ?? "");
    if (!discovery.ok) {
      return {
        healthy: false,
        failure: discovery.kind === "UNREACHABLE" ? "UNREACHABLE" : "CONFIGURATION",
        detail: discovery.detail,
      };
    }
    // Fetching the key set proves the endpoint the tokens will be verified
    // against is reachable and returns keys — the one remaining thing that
    // can be checked without a person in a browser.
    try {
      const response = await fetchImpl(discovery.metadata.jwksUri, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        return {
          healthy: false,
          failure: "UNREACHABLE",
          detail: `The signing keys answered ${response.status}.`,
        };
      }
      const document = (await response.json()) as { keys?: unknown };
      if (!Array.isArray(document.keys) || document.keys.length === 0) {
        return {
          healthy: false,
          failure: "CONFIGURATION",
          detail: "That identity provider publishes no signing keys.",
        };
      }
    } catch (thrown) {
      return {
        healthy: false,
        failure: "UNREACHABLE",
        detail: `Could not reach the signing keys: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      };
    }

    return {
      healthy: true,
      failure: "NONE",
      verifiedCapabilities: ["sso_oidc", "scim_provisioning"],
    };
  }

  const window = certificateWindow(config.certificates ?? []);
  if (!window.ok) {
    return { healthy: false, failure: "CONFIGURATION", detail: window.detail };
  }

  const report: HealthReport = {
    healthy: true,
    failure: "NONE",
    verifiedCapabilities: ["sso_saml", "scim_provisioning"],
  };
  if (window.earliestNotAfter) {
    // Reported, never enforced. A certificate with twelve days left is not a
    // broken connection, and marking it broken would withdraw sign-in a month
    // before anything was actually wrong — an outage manufactured out of the
    // most routine event in identity operations.
    report.credentialExpiresAt = window.earliestNotAfter.toISOString();
  }
  return report;
}
