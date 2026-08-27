import { parseIdpMetadata, normalizeCertificate } from "./metadata";
import type { ConnectorSession } from "./types";

export type SsoProtocol = "OIDC" | "SAML";

export type OktaConfig = {
  protocol: SsoProtocol;

  // --- OIDC ---
  /**
   * The authorization server, e.g. `https://acme.okta.com/oauth2/default`.
   * Compared byte-for-byte against the `iss` of every token.
   */
  issuer?: string;
  clientId?: string;

  // --- SAML ---
  idpEntityId?: string;
  ssoUrl?: string;
  /**
   * Signing certificates, base64 DER. Always a list: an identity provider
   * publishes its next certificate beside its current one during a rollover.
   */
  certificates?: string[];
  /**
   * Okta signs the assertion by default and the response only when asked, so
   * this follows the customer's setting rather than assuming. The assertion
   * signature is required unconditionally.
   */
  responseSigned?: boolean;
};

export type OktaSecrets = {
  /** OIDC only. The back-channel code exchange is the only thing that uses it. */
  clientSecret?: string;
};

export type ParseResult =
  | { ok: true; config: OktaConfig; secrets: OktaSecrets }
  | { ok: false; errors: Record<string, string> };

function str(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === "string" ? value.trim() : "";
}

function httpsUrl(value: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  // http://localhost is allowed so the sign-in loop can be exercised against
  // the fake identity provider in dev and E2E. Nothing else is.
  const local = parsed.protocol === "http:" && parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !local) return null;
  return parsed;
}

/** Errors are keyed by the form control's own `name`. */
export function parseConfig(raw: Record<string, unknown>): ParseResult {
  const errors: Record<string, string> = {};

  const protocolRaw = str(raw, "protocol") || "OIDC";
  if (protocolRaw !== "OIDC" && protocolRaw !== "SAML") {
    return { ok: false, errors: { protocol: "Choose OIDC or SAML." } };
  }
  const protocol = protocolRaw as SsoProtocol;

  if (protocol === "OIDC") {
    const issuerRaw = str(raw, "issuer").replace(/\/+$/, "");
    if (!issuerRaw) {
      errors.issuer = "Required — your authorization server URL.";
    } else if (!httpsUrl(issuerRaw)) {
      errors.issuer = "Must be an https:// URL.";
    } else if (issuerRaw.includes("/.well-known/")) {
      errors.issuer = "Drop the /.well-known/… part — just the issuer URL itself.";
    }

    const clientId = str(raw, "clientId");
    if (!clientId) errors.clientId = "Required — from the application you created.";

    const clientSecret = str(raw, "clientSecret");
    if (!clientSecret) {
      errors.clientSecret = "Required — the client secret for that application.";
    }

    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return {
      ok: true,
      config: { protocol, issuer: issuerRaw, clientId },
      secrets: { clientSecret },
    };
  }

  const metadataXml = str(raw, "metadataXml");
  let entityId = str(raw, "idpEntityId");
  let ssoUrl = str(raw, "ssoUrl");
  let certificates: string[] = [];

  if (metadataXml) {
    const parsed = parseIdpMetadata(metadataXml);
    if (!parsed.ok) {
      return { ok: false, errors: { metadataXml: parsed.error } };
    }
    entityId = parsed.metadata.entityId;
    ssoUrl = parsed.metadata.ssoUrl;
    certificates = parsed.metadata.certificates;
  } else {
    if (!entityId) errors.idpEntityId = "Required — or paste the metadata document instead.";
    if (!ssoUrl) {
      errors.ssoUrl = "Required — or paste the metadata document instead.";
    } else if (!httpsUrl(ssoUrl)) {
      errors.ssoUrl = "Must be an https:// URL.";
    }
    const certificate = normalizeCertificate(str(raw, "certificate"));
    if (!certificate) {
      errors.certificate = "Required — the signing certificate, or paste the metadata document.";
    } else {
      certificates = [certificate];
    }
  }

  for (const certificate of certificates) {
    if (!/^[A-Za-z0-9+/=]+$/.test(certificate)) {
      errors.certificate = "That doesn't look like a certificate.";
      break;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const config: OktaConfig = {
    protocol,
    idpEntityId: entityId,
    ssoUrl,
    certificates,
    responseSigned: raw.responseSigned === "on" || raw.responseSigned === true,
  };
  return { ok: true, config, secrets: {} };
}

export function readSession(session: ConnectorSession): {
  config: OktaConfig;
  secrets: OktaSecrets;
} {
  const config = session.config as unknown as OktaConfig;
  if (config?.protocol !== "OIDC" && config?.protocol !== "SAML") {
    throw new Error("This identity-provider connection has no protocol configured.");
  }
  return { config, secrets: (session.secrets ?? {}) as OktaSecrets };
}
