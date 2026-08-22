import { describe, it, expect } from "vitest";
import { parseConfig, readSession } from "./config";
import { createFakeOkta } from "./testing/fake-okta";

describe("the connect form", () => {
  it("keeps the client secret out of config and everything else out of secrets", () => {
    const result = parseConfig({
      protocol: "OIDC",
      issuer: "https://acme.okta.com/oauth2/default",
      clientId: "0oaABC",
      clientSecret: "shhh",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The split is the integration's call, and getting it wrong here is what
    // puts a live credential in a page a support screenshot can capture.
    expect(result.secrets).toEqual({ clientSecret: "shhh" });
    expect(JSON.stringify(result.config)).not.toContain("shhh");
  });

  it("names the field an admin got wrong, not just that it failed", () => {
    const result = parseConfig({ protocol: "OIDC", issuer: "", clientId: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["clientId", "clientSecret", "issuer"]);
  });

  it("tells someone who pasted the discovery URL what to trim", () => {
    const result = parseConfig({
      protocol: "OIDC",
      issuer: "https://acme.okta.com/oauth2/default/.well-known/openid-configuration",
      clientId: "0oaABC",
      clientSecret: "shhh",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.issuer).toMatch(/well-known/);
  });

  it("refuses an issuer that isn't https", () => {
    const result = parseConfig({
      protocol: "OIDC",
      issuer: "http://acme.okta.com/oauth2/default",
      clientId: "0oaABC",
      clientSecret: "shhh",
    });
    expect(result.ok).toBe(false);
  });

  it("takes the entity id, sign-in URL and certificates straight out of pasted metadata", () => {
    const fake = createFakeOkta();
    const metadata =
      `<?xml version="1.0"?><md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="http://www.okta.test/exk1">` +
      `<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">` +
      `<md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data>` +
      `<ds:X509Certificate>${fake.certificateBody}</ds:X509Certificate>` +
      `</ds:X509Data></ds:KeyInfo></md:KeyDescriptor>` +
      `<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://acme.okta.test/app/sso/saml"/>` +
      `</md:IDPSSODescriptor></md:EntityDescriptor>`;

    const result = parseConfig({ protocol: "SAML", metadataXml: metadata });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.idpEntityId).toBe("http://www.okta.test/exk1");
    expect(result.config.ssoUrl).toBe("https://acme.okta.test/app/sso/saml");
    expect(result.config.certificates).toEqual([fake.certificateBody]);
  });

  it("accepts the two values typed by hand when there is no metadata to paste", () => {
    const fake = createFakeOkta();
    const result = parseConfig({
      protocol: "SAML",
      idpEntityId: "http://www.okta.test/exk1",
      ssoUrl: "https://acme.okta.test/app/sso/saml",
      certificate: fake.certificate.certificatePem,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // PEM armour stripped, so what is stored is what a document carries.
    expect(result.config.certificates).toEqual([fake.certificateBody]);
  });

  it("refuses a metadata document with a DOCTYPE declaration", () => {
    const result = parseConfig({
      protocol: "SAML",
      metadataXml: `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><md:EntityDescriptor/>`,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.metadataXml).toMatch(/DOCTYPE/i);
  });

  it("refuses a session with no protocol rather than guessing one", () => {
    expect(() => readSession({ config: {}, secrets: {} })).toThrow(/protocol/i);
  });
});
