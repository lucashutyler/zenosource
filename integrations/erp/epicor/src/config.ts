// What a buyer's IT admin types on the connect form, and how it's validated.
//
// Split deliberately into `config` (non-secret, stored as JSON and shown back
// on the page) and `secrets` (sealed, never rendered). The split is the
// integration's call, not the platform's — the platform stores whatever each
// side of this returns without looking inside it.

export type EpicorAuthMode = "basic" | "oauth2";

export type EpicorConfig = {
  /**
   * The Kinetic application server root, e.g.
   * `https://kinetic.acme.com/KineticProd`. Not the `/api/v2/...` path — this
   * connector appends that, so a customer pasting the URL out of their
   * browser address bar works.
   */
  baseUrl: string;
  /** Epicor Company ID, e.g. `EPIC06`. Every OData path is scoped by it. */
  company: string;
  authMode: EpicorAuthMode;
  /** OAuth2 only: the token endpoint, when it isn't the default on baseUrl. */
  tokenUrl?: string;
};

export type EpicorSecrets = {
  /** From Security > API Key Maintenance, tied to an Access Scope. */
  apiKey: string;
  /** Basic auth: the Epicor service account. */
  username?: string;
  password?: string;
  /** OAuth2: client credentials for TokenResource.svc / the customer's IdP. */
  clientId?: string;
  clientSecret?: string;
};

export type ParseResult =
  | { ok: true; config: EpicorConfig; secrets: EpicorSecrets }
  | { ok: false; errors: Record<string, string> };

function str(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Errors are keyed by the form control's own `name`, which is the convention
 * every other form in the product has used since Phase 1b Wave 1 — the wave
 * that existed because `Line N: Invalid input` was the only message the PO
 * form could produce. An admin who mistypes a company id should be told which
 * box is wrong, not that the connection failed.
 */
export function parseConfig(raw: Record<string, unknown>): ParseResult {
  const errors: Record<string, string> = {};

  let baseUrl = str(raw, "baseUrl");
  if (!baseUrl) {
    errors.baseUrl = "Required — your Kinetic server URL.";
  } else {
    // Tolerate the two things people actually paste: a trailing slash, and
    // the full REST path copied out of Epicor's own API help page.
    baseUrl = baseUrl.replace(/\/+$/, "").replace(/\/api\/v[12](\/.*)?$/i, "");
    let parsed: URL | null = null;
    try {
      parsed = new URL(baseUrl);
    } catch {
      parsed = null;
    }
    if (!parsed) {
      errors.baseUrl = "That doesn't look like a URL — it should start with https://";
    } else if (parsed.protocol !== "https:") {
      // An ERP service account travels on every request. http:// would put it
      // on the wire in cleartext, and "it's an internal network" is how it
      // ends up crossing a VPN boundary later.
      errors.baseUrl = "Must be https:// — these credentials can't travel unencrypted.";
    }
  }

  const company = str(raw, "company");
  if (!company) {
    errors.company = "Required — your Epicor Company ID, e.g. EPIC06.";
  }

  const authModeRaw = str(raw, "authMode") || "basic";
  if (authModeRaw !== "basic" && authModeRaw !== "oauth2") {
    errors.authMode = "Choose Basic or OAuth2.";
  }
  const authMode = authModeRaw as EpicorAuthMode;

  // The API key is required regardless of auth mode: Kinetic's gateway checks
  // it before authentication runs at all, so there is no configuration in
  // which it's optional. docs/integrations.md#epicor-erp.
  const apiKey = str(raw, "apiKey");
  if (!apiKey) {
    errors.apiKey = "Required — from Epicor's Security > API Key Maintenance.";
  }

  const secrets: EpicorSecrets = { apiKey };

  if (authMode === "basic") {
    const username = str(raw, "username");
    const password = str(raw, "password");
    if (!username) errors.username = "Required for Basic authentication.";
    if (!password) errors.password = "Required for Basic authentication.";
    secrets.username = username;
    secrets.password = password;
  } else {
    const clientId = str(raw, "clientId");
    const clientSecret = str(raw, "clientSecret");
    if (!clientId) errors.clientId = "Required for OAuth2.";
    if (!clientSecret) errors.clientSecret = "Required for OAuth2.";
    secrets.clientId = clientId;
    secrets.clientSecret = clientSecret;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const config: EpicorConfig = { baseUrl, company, authMode };
  const tokenUrl = str(raw, "tokenUrl");
  if (tokenUrl) config.tokenUrl = tokenUrl;

  return { ok: true, config, secrets };
}

/** Narrows the opaque session the platform hands back. */
export function readSession(session: {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}): { config: EpicorConfig; secrets: EpicorSecrets } {
  const config = session.config as unknown as EpicorConfig;
  if (!config?.baseUrl || !config?.company) {
    throw new Error("Epicor connection is missing baseUrl or company.");
  }
  return { config, secrets: session.secrets as EpicorSecrets };
}
