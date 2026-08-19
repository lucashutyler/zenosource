import type { EpicorConfig, EpicorSecrets } from "./config";
import { EpicorError, classifyHttpFailure, isTransportFailure } from "./errors";

// The Kinetic REST transport.
//
// Surface: Kinetic REST API v2, which is OData v4-compliant
// (docs/integrations.md#epicor-erp). Every request carries *both* credentials:
// the API key in `x-api-key`, and an identity as either Basic or a Bearer
// token. Neither is optional and they fail at different layers — see errors.ts.

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export type ClientOptions = {
  /**
   * Injected so every test in this package runs against a scripted transport
   * and none against a live ERP. There is no Kinetic instance in CI, and a
   * connector whose tests need one is a connector with no tests.
   */
  fetchImpl?: FetchLike;
  /** Per-request ceiling. An ERP that hangs must not hang a sync run. */
  timeoutMs?: number;
};

type ODataPage<T> = {
  value?: T[];
  "@odata.nextLink"?: string;
  "odata.nextLink"?: string;
};

export class EpicorClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private bearer: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: EpicorConfig,
    private readonly secrets: EpicorSecrets,
    options: ClientOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** `https://host/App/api/v2/odata/EPIC06/Erp.BO.VendorSvc/Vendors` */
  url(service: string, resource: string, query?: Record<string, string | number | undefined>): string {
    const base = `${this.config.baseUrl}/api/v2/odata/${encodeURIComponent(this.config.company)}/${service}/${resource}`;
    if (!query) return base;
    // Built by hand rather than with URLSearchParams, which serializes in
    // application/x-www-form-urlencoded and therefore encodes a space as `+`.
    // In a form body that is correct; in an OData `$filter` it is a coin
    // flip — `ChangeDate+ge+2026-08-01` is read as a space by servers that
    // apply form rules to the query string and as a literal `+` by those that
    // don't, and the second kind rejects the filter. encodeURIComponent gives
    // `%20`, which every one of them reads the same way.
    const parts: string[] = [];
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === "") continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    return parts.length > 0 ? `${base}?${parts.join("&")}` : base;
  }

  /** Epicor Functions (EFx) and BAQ services sit off a different root. */
  efxUrl(library: string, fn: string): string {
    return `${this.config.baseUrl}/api/v2/efx/${encodeURIComponent(this.config.company)}/${library}/${fn}`;
  }

  baqUrl(baqId: string): string {
    return `${this.config.baseUrl}/api/v2/odata/${encodeURIComponent(this.config.company)}/BaqSvc/${encodeURIComponent(baqId)}/Data`;
  }

  private async identityHeaders(includeIdentity = true): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      // Layer one. Checked by the gateway before authentication happens.
      "x-api-key": this.secrets.apiKey ?? "",
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (!includeIdentity) return headers;

    if (this.config.authMode === "oauth2") {
      headers.Authorization = `Bearer ${await this.accessToken()}`;
    } else {
      const pair = `${this.secrets.username ?? ""}:${this.secrets.password ?? ""}`;
      headers.Authorization = `Basic ${Buffer.from(pair, "utf8").toString("base64")}`;
    }
    return headers;
  }

  /**
   * Client-credentials token, cached until 60s before expiry. Epicor's
   * TokenResource.svc is the default issuer; a customer federating Kinetic to
   * Azure AD points `tokenUrl` at their own tenant instead.
   */
  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.bearer && this.bearer.expiresAt - 60_000 > now) return this.bearer.token;

    const tokenUrl = this.config.tokenUrl ?? `${this.config.baseUrl}/api/v2/TokenResource.svc/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.secrets.clientId ?? "",
      client_secret: this.secrets.clientSecret ?? "",
    }).toString();

    const response = await this.send(tokenUrl, {
      method: "POST",
      headers: {
        "x-api-key": this.secrets.apiKey ?? "",
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    const text = await response.text();
    if (!response.ok) {
      const { kind } = classifyHttpFailure(response.status, text, response.headers);
      throw new EpicorError(
        `Could not obtain an OAuth2 token from Epicor (HTTP ${response.status}).`,
        // A token endpoint rejecting client credentials is an identity
        // failure unless it specifically named the API key.
        kind === "API_KEY" ? "API_KEY" : "IDENTITY",
        response.status,
        text
      );
    }

    const parsed = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!parsed.access_token) {
      throw new EpicorError(
        "Epicor's token endpoint returned no access_token.",
        "CONFIGURATION",
        response.status,
        text
      );
    }
    this.bearer = {
      token: parsed.access_token,
      expiresAt: now + (parsed.expires_in ?? 3600) * 1000,
    };
    return this.bearer.token;
  }

  private async send(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string }
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (isTransportFailure(error)) {
        throw new EpicorError(
          `Could not reach ${new URL(url).host}: ${(error as Error).message}`,
          "UNREACHABLE"
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async request<T>(
    url: string,
    init: { method?: string; body?: unknown; includeIdentity?: boolean } = {}
  ): Promise<T> {
    const headers = await this.identityHeaders(init.includeIdentity ?? true);
    const response = await this.send(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    if (!response.ok) {
      const { kind } = classifyHttpFailure(response.status, text, response.headers);
      throw new EpicorError(
        `Epicor returned HTTP ${response.status} for ${new URL(url).pathname}`,
        kind,
        response.status,
        text
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Raw probe used only by the health check's disambiguation step — returns
   * the status and body instead of throwing, and can deliberately omit the
   * identity header to see which layer answers.
   */
  async probe(
    url: string,
    options: { includeIdentity?: boolean } = {}
  ): Promise<{ status: number; body: string; headers: { get(n: string): string | null } }> {
    const headers = await this.identityHeaders(options.includeIdentity ?? true);
    const response = await this.send(url, { method: "GET", headers });
    return { status: response.status, body: await response.text(), headers: response.headers };
  }

  /**
   * Pages an OData collection. Follows `@odata.nextLink` when the server
   * sends one and falls back to `$skip` when it doesn't — Kinetic does both
   * depending on version and on whether the query hit a server-side page cap.
   */
  async *pages<T>(
    service: string,
    resource: string,
    query: Record<string, string | number | undefined> = {},
    pageSize = 500
  ): AsyncGenerator<T[]> {
    let url: string | null = this.url(service, resource, { ...query, $top: pageSize, $skip: 0 });
    let skip = 0;
    let guard = 0;

    while (url) {
      // A server that keeps returning a nextLink pointing at itself would
      // spin forever inside a sync run holding a database transaction open.
      if (++guard > 10_000) {
        throw new EpicorError(
          `Refusing to follow more than 10,000 pages of ${resource} — the server is not advancing.`,
          "CONFIGURATION"
        );
      }
      const page: ODataPage<T> = await this.request<ODataPage<T>>(url);
      const rows = page.value ?? [];
      if (rows.length > 0) yield rows;

      const next = page["@odata.nextLink"] ?? page["odata.nextLink"];
      if (next) {
        url = next.startsWith("http") ? next : `${this.config.baseUrl}/${next.replace(/^\/+/, "")}`;
      } else if (rows.length === pageSize) {
        skip += pageSize;
        url = this.url(service, resource, { ...query, $top: pageSize, $skip: skip });
      } else {
        url = null;
      }
    }
  }
}

/**
 * `ChangeDate ge 2026-08-01T00:00:00Z` — the incremental-pull filter.
 *
 * Kinetic exposes a last-changed column on most transactional tables, but not
 * under one consistent name, so the field is passed in by each BO module
 * rather than assumed here. When a caller has no watermark (first sync) this
 * returns undefined and the pull is full.
 */
export function changedSinceFilter(field: string, since?: Date): string | undefined {
  if (!since) return undefined;
  return `${field} ge ${since.toISOString().replace(/\.\d{3}Z$/, "Z")}`;
}
