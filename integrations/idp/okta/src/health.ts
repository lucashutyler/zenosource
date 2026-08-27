import { X509Certificate } from "node:crypto";
import { discover } from "./oidc/discovery";
import type { OktaConfig } from "./config";
import type { FetchLike, HealthReport } from "./types";

export type OktaCapability = "sso_oidc" | "sso_saml" | "scim_provisioning";

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
    report.credentialExpiresAt = window.earliestNotAfter.toISOString();
  }
  return report;
}
