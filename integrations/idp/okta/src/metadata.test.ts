import { describe, it, expect } from "vitest";
import { parseIdpMetadata, normalizeCertificate } from "./metadata";
import { createFakeOkta } from "./testing/fake-okta";

const fake = createFakeOkta();

function metadata(options: { certificates?: string[]; use?: string; binding?: string } = {}) {
  const certificates = options.certificates ?? [fake.certificateBody];
  const use = options.use === undefined ? ' use="signing"' : options.use ? ` use="${options.use}"` : "";
  const binding = options.binding ?? "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
  return (
    `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="http://www.okta.test/exk1">` +
    `<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">` +
    certificates
      .map(
        (c) =>
          `<md:KeyDescriptor${use}><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">` +
          `<ds:X509Data><ds:X509Certificate>${c}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`
      )
      .join("") +
    `<md:SingleSignOnService Binding="${binding}" Location="https://acme.okta.test/app/sso/saml"/>` +
    `</md:IDPSSODescriptor></md:EntityDescriptor>`
  );
}

describe("reading identity-provider metadata", () => {
  it("takes the entity id, the sign-in URL and every signing certificate", () => {
    const second = createFakeOkta();
    const result = parseIdpMetadata(
      metadata({ certificates: [fake.certificateBody, second.certificateBody] })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadata.entityId).toBe("http://www.okta.test/exk1");
    expect(result.metadata.ssoUrl).toBe("https://acme.okta.test/app/sso/saml");
    expect(result.metadata.certificates).toEqual([fake.certificateBody, second.certificateBody]);
  });

  it("skips a key that is only for encryption", () => {
    const result = parseIdpMetadata(metadata({ use: "encryption" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no signing certificate/i);
  });

  it("takes a key with no stated use, since that means every use", () => {
    const result = parseIdpMetadata(metadata({ use: "" }));
    expect(result.ok).toBe(true);
  });

  it("refuses a DOCTYPE declaration before parsing", () => {
    const result = parseIdpMetadata(`<!DOCTYPE x><md:EntityDescriptor/>`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/DOCTYPE/i);
  });

  it("says what is wrong when the document is XML but not metadata", () => {
    const result = parseIdpMetadata("<hello>world</hello>");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/identity-provider/i);
  });

  it("strips PEM armour and every kind of whitespace", () => {
    expect(normalizeCertificate("-----BEGIN CERTIFICATE-----\nAB\nCD\n-----END CERTIFICATE-----")).toBe(
      "ABCD"
    );
  });
});
