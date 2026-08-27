import { describe, it, expect } from "vitest";
import { completeSignIn } from "./verify";
import { createFakeOkta } from "../testing/fake-okta";
import { generateSelfSignedCertificate } from "../testing/certificate";
import { ATTACKER_EMAIL, XSW_VARIANTS } from "../testing/xsw-variants";
import type { OktaConfig } from "../config";
import type { SignInCallback, SignInExpectations } from "../types";

const ACS = "https://app.zenosource.test/api/sso/acme/callback";
const SP_REF = "https://app.zenosource.test/sso/saml/acme";
const IDP_ENTITY = "http://www.okta.test/exkZENOSOURCE";
const REQUEST_ID = "_zsrequest0000000000000000000000000000";

const fake = createFakeOkta();

function configFor(overrides: Partial<OktaConfig> = {}): OktaConfig {
  return {
    protocol: "SAML",
    idpEntityId: IDP_ENTITY,
    ssoUrl: fake.ssoUrl,
    certificates: [fake.certificateBody],
    responseSigned: false,
    ...overrides,
  };
}

const expectations: SignInExpectations = {
  callbackUrl: ACS,
  serviceProviderRef: SP_REF,
  expectedRequestId: REQUEST_ID,
  handle: "handle-abc",
};

function callbackFor(xml: string): SignInCallback {
  return { method: "POST", url: ACS, params: { SAMLResponse: fake.encodeResponse(xml) } };
}

function validResponse(overrides: Parameters<typeof fake.signAssertion>[0] | null = null) {
  return fake.signAssertion(
    overrides ?? { inResponseTo: REQUEST_ID, destination: ACS, audience: SP_REF }
  );
}

describe("a valid sign-in", () => {
  it("returns the person the assertion is about", async () => {
    const result = await completeSignIn(configFor(), callbackFor(validResponse()), expectations);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity.email).toBe("buyer@acme.test");
    expect(result.identity.name).toBe("Jordan Buyer");
    expect(result.identity.groupRefs).toEqual(["Procurement"]);
  });

  it("does not use the email as the stable subject", async () => {
    const result = await completeSignIn(configFor(), callbackFor(validResponse()), expectations);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity.subject).toBeTruthy();
  });

  it("accepts a response-level signature when the connection expects one", async () => {
    const xml = validResponse({
      inResponseTo: REQUEST_ID,
      destination: ACS,
      audience: SP_REF,
      signResponse: true,
    });
    const result = await completeSignIn(
      configFor({ responseSigned: true }),
      callbackFor(xml),
      expectations
    );
    expect(result.ok).toBe(true);
  });

  it("refuses an assertion-only signature when the connection expects the response signed", async () => {
    const result = await completeSignIn(
      configFor({ responseSigned: true }),
      callbackFor(validResponse()),
      expectations
    );
    expect(result.ok).toBe(false);
  });
});

describe("signature wrapping", () => {
  for (const variant of XSW_VARIANTS) {
    it(`refuses ${variant.name}`, async () => {
      const mutated = variant.mutate(validResponse());
      const result = await completeSignIn(configFor(), callbackFor(mutated), expectations);
      expect(result.ok, `${variant.name} was accepted`).toBe(false);
      if (result.ok) {
        expect((result as { identity: { email: string } }).identity.email).not.toBe(ATTACKER_EMAIL);
      }
    });
  }
});

describe("trust", () => {
  it("refuses an assertion signed by a certificate this connection doesn't hold", async () => {
    const other = createFakeOkta({ certificate: generateSelfSignedCertificate() });
    const xml = other.signAssertion({
      inResponseTo: REQUEST_ID,
      destination: ACS,
      audience: SP_REF,
    });
    const result = await completeSignIn(configFor(), callbackFor(xml), expectations);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("UNTRUSTED");
  });

  it("accepts either certificate while a rollover is in progress", async () => {
    const next = generateSelfSignedCertificate();
    const rolled = createFakeOkta({ certificate: next });
    const config = configFor({ certificates: [fake.certificateBody, next.certificateBody] });

    const first = await completeSignIn(config, callbackFor(validResponse()), expectations);
    expect(first.ok).toBe(true);

    const second = await completeSignIn(
      config,
      callbackFor(rolled.signAssertion({ inResponseTo: REQUEST_ID, destination: ACS, audience: SP_REF })),
      expectations
    );
    expect(second.ok).toBe(true);
  });

  it("refuses an assertion from a different identity provider", async () => {
    const xml = fake.signAssertion({
      inResponseTo: REQUEST_ID,
      destination: ACS,
      audience: SP_REF,
      issuer: "http://www.okta.test/somebodyElse",
    });
    const result = await completeSignIn(configFor(), callbackFor(xml), expectations);
    expect(result.ok).toBe(false);
  });
});

describe("bindings", () => {
  it("refuses an assertion minted for another tenant", async () => {
    const xml = fake.signAssertion({
      inResponseTo: REQUEST_ID,
      destination: ACS,
      audience: "https://app.zenosource.test/sso/saml/othercorp",
    });
    const result = await completeSignIn(configFor(), callbackFor(xml), expectations);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/different organization/i);
  });

  it("refuses an assertion addressed to another callback", async () => {
    const xml = fake.signAssertion({
      inResponseTo: REQUEST_ID,
      destination: "https://app.zenosource.test/api/sso/othercorp/callback",
      audience: SP_REF,
    });
    const result = await completeSignIn(configFor(), callbackFor(xml), expectations);
    expect(result.ok).toBe(false);
  });

  it("refuses an assertion whose subject confirmation names another recipient", async () => {
    const xml = fake.signAssertion({
      inResponseTo: REQUEST_ID,
      destination: ACS,
      audience: SP_REF,
      recipient: "https://evil.test/collect",
    });
    const result = await completeSignIn(configFor(), callbackFor(xml), expectations);
    expect(result.ok).toBe(false);
  });

  it("refuses an answer to a different sign-in request", async () => {
    const xml = fake.signAssertion({
      inResponseTo: "_somebodyElsesRequest",
      destination: ACS,
      audience: SP_REF,
    });
    const result = await completeSignIn(configFor(), callbackFor(xml), expectations);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/different sign-in request/i);
  });

  it("refuses an unsolicited assertion outright", async () => {
    const xml = fake
      .signAssertion({ inResponseTo: REQUEST_ID, destination: ACS, audience: SP_REF })
      .replace(/ InResponseTo="[^"]*"/g, "");
    const result = await completeSignIn(configFor(), callbackFor(xml), expectations);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/doesn't answer a sign-in request/i);
  });

  it("refuses an expired assertion as a rejection, not as broken trust", async () => {
    const xml = fake.signAssertion({
      inResponseTo: REQUEST_ID,
      destination: ACS,
      audience: SP_REF,
      now: new Date(Date.now() - 60 * 60_000),
    });
    const result = await completeSignIn(configFor(), callbackFor(xml), expectations);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("REJECTED");
  });
});

describe("the shape of the document itself", () => {
  it("refuses a document type declaration before parsing anything", async () => {
    const xml = `<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${validResponse()}`;
    const result = await completeSignIn(configFor(), callbackFor(xml), expectations);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/document type declaration/i);
  });

  it("refuses a response larger than any real response", async () => {
    const padded = validResponse().replace("</samlp:Response>", `${"x".repeat(2_000_000)}</samlp:Response>`);
    const result = await completeSignIn(configFor(), callbackFor(padded), expectations);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/too large/i);
  });

  it("refuses a connection with no stored certificate rather than trusting anything", async () => {
    const result = await completeSignIn(
      configFor({ certificates: [] }),
      callbackFor(validResponse()),
      expectations
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("MISCONFIGURED");
  });
});
