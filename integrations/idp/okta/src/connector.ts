import { parseConfig, readSession, type OktaConfig, type OktaSecrets } from "./config";
import { checkHealth } from "./health";
import { beginSignIn as beginOidc, completeSignIn as completeOidc } from "./oidc/verify";
import { beginSignIn as beginSaml } from "./saml/request";
import { completeSignIn as completeSaml } from "./saml/verify";
import { renderServiceProviderMetadata } from "./sp-metadata";
import { handleDirectoryRequest } from "./scim/handle";
import type {
  ConnectorSession,
  DirectoryRequest,
  DirectoryResponse,
  DirectoryStore,
  FetchLike,
  HealthReport,
  IdpConnector,
  SignInCallback,
  SignInExpectations,
  SignInRedirect,
  SignInResult,
} from "./types";

export const OKTA_CAPABILITIES = ["sso_oidc", "sso_saml", "scim_provisioning"] as const;

export type OktaConnectorOptions = {
  fetchImpl?: FetchLike;
};

/**
 * One connector, two protocols, not two registry entries:
 * `IntegrationConnection` is unique on (tenant, integration), and directory
 * provisioning is protocol-independent.
 */
export class OktaConnector implements IdpConnector {
  readonly integrationId = "okta";

  constructor(private readonly options: OktaConnectorOptions = {}) {}

  private fetchImpl(): FetchLike {
    return this.options.fetchImpl ?? ((globalThis as { fetch: FetchLike }).fetch as FetchLike);
  }

  parseConfig(raw: Record<string, unknown>) {
    const result = parseConfig(raw);
    if (!result.ok) return result;
    return {
      ok: true as const,
      config: result.config as unknown as Record<string, unknown>,
      secrets: result.secrets as unknown as Record<string, string>,
    };
  }

  async checkHealth(session: ConnectorSession): Promise<HealthReport> {
    const { config } = readSession(session);
    return checkHealth(this.fetchImpl(), config);
  }

  /**
   * OIDC calls the slot `state`, SAML calls it `RelayState`. Not a trust
   * decision — the value is a lookup key for a single-use row.
   */
  readHandle(callback: SignInCallback): string | null {
    return callback.params.state || callback.params.RelayState || null;
  }

  async beginSignIn(
    session: ConnectorSession,
    params: {
      callbackUrl: string;
      serviceProviderRef: string;
      handle: string;
      loginHint?: string | null;
    }
  ): Promise<SignInRedirect> {
    const { config } = readSession(session);
    if (config.protocol === "OIDC") {
      return beginOidc(this.fetchImpl(), config, params);
    }
    return beginSaml(config, params);
  }

  async completeSignIn(
    session: ConnectorSession,
    callback: SignInCallback,
    expectations: SignInExpectations
  ): Promise<SignInResult> {
    const { config, secrets } = readSession(session);
    if (config.protocol === "OIDC") {
      return completeOidc(this.fetchImpl(), config, secrets, callback, expectations);
    }
    return completeSaml(config, callback, expectations);
  }

  async describeServiceProvider(
    session: ConnectorSession,
    params: { callbackUrl: string; serviceProviderRef: string }
  ): Promise<{ contentType: string; body: string }> {
    const { config } = readSession(session);
    if (config.protocol === "SAML") {
      return renderServiceProviderMetadata(params);
    }
    return {
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(
        {
          client_name: "ZenoSource",
          redirect_uris: [params.callbackUrl],
          application_type: "web",
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "client_secret_basic",
          id_token_signed_response_alg: "RS256",
          scope: "openid email profile groups",
        },
        null,
        2
      ),
    };
  }

  async handleDirectoryRequest(
    _session: ConnectorSession,
    request: DirectoryRequest,
    store: DirectoryStore
  ): Promise<DirectoryResponse> {
    // The directory leg is inbound: everything that authorizes it was settled
    // by the platform before this is called, so no session is read.
    return handleDirectoryRequest(request, store);
  }
}

export const oktaConnector = new OktaConnector();

export type { OktaConfig, OktaSecrets };
