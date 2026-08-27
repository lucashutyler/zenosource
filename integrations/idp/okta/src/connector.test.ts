import { describe, it, expect } from "vitest";
import { OktaConnector, oktaConnector, OKTA_CAPABILITIES } from "./connector";
import { createFakeOkta } from "./testing/fake-okta";
import { createMemoryStore } from "./testing/memory-store";
import type { ConnectorSession } from "./types";

describe("the connector as the platform sees it", () => {
  it("answers to the id the registry knows", () => {
    expect(oktaConnector.integrationId).toBe("okta");
  });

  it("declares exactly the capabilities it can verify", () => {
    expect([...OKTA_CAPABILITIES].sort()).toEqual(["scim_provisioning", "sso_oidc", "sso_saml"]);
  });

  it("dispatches on the protocol the connection was configured with", async () => {
    const fake = createFakeOkta();
    const connector = new OktaConnector({ fetchImpl: fake.fetchImpl });

    const oidc: ConnectorSession = {
      config: { protocol: "OIDC", issuer: fake.issuer, clientId: fake.clientId },
      secrets: { clientSecret: fake.clientSecret },
    };
    const started = await connector.beginSignIn(oidc, {
      callbackUrl: "https://app.zenosource.test/api/sso/acme/callback",
      serviceProviderRef: fake.clientId,
      handle: "h",
    });
    expect(started.url).toContain("code_challenge_method=S256");

    const saml: ConnectorSession = {
      config: {
        protocol: "SAML",
        idpEntityId: "http://www.okta.test/exk1",
        ssoUrl: fake.ssoUrl,
        certificates: [fake.certificateBody],
      },
      secrets: {},
    };
    const samlStart = await connector.beginSignIn(saml, {
      callbackUrl: "https://app.zenosource.test/api/sso/acme/callback",
      serviceProviderRef: "https://app.zenosource.test/sso/saml/acme",
      handle: "h",
    });
    expect(samlStart.url).toContain("SAMLRequest=");
    expect(samlStart.requestId).toMatch(/^_/);
  });

  it("describes itself in the shape each protocol's admin screen wants", async () => {
    const fake = createFakeOkta();
    const connector = new OktaConnector({ fetchImpl: fake.fetchImpl });
    const params = {
      callbackUrl: "https://app.zenosource.test/api/sso/acme/callback",
      serviceProviderRef: "https://app.zenosource.test/sso/saml/acme",
    };

    const saml = await connector.describeServiceProvider(
      { config: { protocol: "SAML", idpEntityId: "x", ssoUrl: fake.ssoUrl, certificates: [fake.certificateBody] }, secrets: {} },
      params
    );
    expect(saml.contentType).toContain("samlmetadata");
    expect(saml.body).toContain(params.serviceProviderRef);
    expect(saml.body).toContain(params.callbackUrl);

    const oidc = await connector.describeServiceProvider(
      { config: { protocol: "OIDC", issuer: fake.issuer, clientId: fake.clientId }, secrets: {} },
      params
    );
    expect(oidc.contentType).toContain("json");
    expect(JSON.parse(oidc.body).redirect_uris).toEqual([params.callbackUrl]);
  });

  it("reads no session on the directory leg", async () => {
    const connector = new OktaConnector();
    const response = await connector.handleDirectoryRequest(
      { config: {}, secrets: {} },
      { method: "GET", segments: ["ServiceProviderConfig"], query: {}, body: null },
      createMemoryStore()
    );
    expect(response.status).toBe(200);
  });
});
