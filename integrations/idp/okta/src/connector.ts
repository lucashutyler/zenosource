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

/**
 * Everything Okta declares in the platform's registry, restated here so the
 * health check knows what to probe without importing the platform.
 * conformance.test.ts on the platform side is what keeps the two in step.
 */
export const OKTA_CAPABILITIES = ["sso_oidc", "sso_saml", "scim_provisioning"] as const;

export type OktaConnectorOptions = {
  /** Injected transport. Every test in this package supplies one. */
  fetchImpl?: FetchLike;
};

/**
 * One connector, two protocols.
 *
 * Not two registry entries. `IntegrationConnection` is unique on
 * (tenant, integration) because a second connection would mean two sources of
 * truth, and directory provisioning is protocol-independent — splitting on
 * protocol would strand a customer's group push on whichever half they did
 * not pick, and offer a SAML customer two cards to choose between when their
 * own admin already made that choice once.
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
   * Where each protocol puts our opaque handle on the way back: OIDC calls the
   * slot `state`, SAML calls it `RelayState`. Both names live here and nowhere
   * in the platform, which is the whole reason this method is on the contract.
   *
   * Not a trust decision — the value is a lookup key for a single-use row, and
   * everything that makes it mean anything happens after it is looked up.
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
    // OIDC has no metadata document to import, but an admin still has to put
    // two values into their application, and this is where they are stated in
    // the protocol's own vocabulary rather than the platform's.
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
    // No session is read: the directory leg is inbound, and everything that
    // authorizes it was settled by the platform before this is called. Taking
    // the parameter anyway keeps one shape for every connector method.
    return handleDirectoryRequest(request, store);
  }
}

export const oktaConnector = new OktaConnector();

export type { OktaConfig, OktaSecrets };
