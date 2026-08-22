import { describe, it, expect } from "vitest";
import { checkHealth } from "./health";
import { createFakeOkta } from "./testing/fake-okta";
import { generateSelfSignedCertificate } from "./testing/certificate";
import type { FetchLike } from "./types";

const unreachable: FetchLike = async () => {
  throw new Error("connect ECONNREFUSED");
};

describe("health, and what it grants", () => {
  it("grants sign-in and provisioning for a working OIDC connection", async () => {
    const fake = createFakeOkta();
    const report = await checkHealth(fake.fetchImpl, {
      protocol: "OIDC",
      issuer: fake.issuer,
      clientId: fake.clientId,
    });
    expect(report.healthy).toBe(true);
    expect(report.verifiedCapabilities).toEqual(["sso_oidc", "scim_provisioning"]);
  });

  it("never grants the protocol that isn't configured", async () => {
    const fake = createFakeOkta();
    const report = await checkHealth(fake.fetchImpl, {
      protocol: "OIDC",
      issuer: fake.issuer,
      clientId: fake.clientId,
    });
    // A feature that unlocks and then cannot work is worse than an absent
    // one — connections.ts intersects declared capabilities with these.
    expect(report.verifiedCapabilities).not.toContain("sso_saml");
  });

  it("grants provisioning for SAML too, because we are the directory server", async () => {
    const fake = createFakeOkta();
    const report = await checkHealth(fake.fetchImpl, {
      protocol: "SAML",
      idpEntityId: "http://www.okta.test/exk1",
      ssoUrl: fake.ssoUrl,
      certificates: [fake.certificateBody],
    });
    expect(report.healthy).toBe(true);
    expect(report.verifiedCapabilities).toEqual(["sso_saml", "scim_provisioning"]);
  });

  it("reports when the signing certificate runs out without calling the connection broken", async () => {
    const fake = createFakeOkta();
    const report = await checkHealth(fake.fetchImpl, {
      protocol: "SAML",
      idpEntityId: "http://www.okta.test/exk1",
      ssoUrl: fake.ssoUrl,
      certificates: [fake.certificateBody],
    });
    // A certificate with time left on it is not a broken connection, and
    // marking it broken would withdraw sign-in a month before anything was
    // actually wrong.
    expect(report.healthy).toBe(true);
    expect(report.credentialExpiresAt).toBeTruthy();
    expect(new Date(report.credentialExpiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it("reports the soonest usable expiry during a rollover, not the newest", async () => {
    const soon = generateSelfSignedCertificate({ lifetimeDays: 30 });
    const later = generateSelfSignedCertificate({ lifetimeDays: 900 });
    const fake = createFakeOkta();
    const report = await checkHealth(fake.fetchImpl, {
      protocol: "SAML",
      idpEntityId: "http://www.okta.test/exk1",
      ssoUrl: fake.ssoUrl,
      certificates: [soon.certificateBody, later.certificateBody],
    });
    expect(report.healthy).toBe(true);
    const reported = new Date(report.credentialExpiresAt!).getTime();
    expect(Math.abs(reported - soon.notAfter.getTime())).toBeLessThan(2000);
  });

  it("is broken when every stored certificate has expired", async () => {
    const expired = generateSelfSignedCertificate({ lifetimeDays: -30 });
    const fake = createFakeOkta();
    const report = await checkHealth(fake.fetchImpl, {
      protocol: "SAML",
      idpEntityId: "http://www.okta.test/exk1",
      ssoUrl: fake.ssoUrl,
      certificates: [expired.certificateBody],
    });
    expect(report.healthy).toBe(false);
    expect(report.failure).toBe("CONFIGURATION");
  });

  it("separates an unreachable identity provider from a misconfigured one", async () => {
    const down = await checkHealth(unreachable, {
      protocol: "OIDC",
      issuer: "https://acme.okta.test/oauth2/default",
      clientId: "0oaABC",
    });
    expect(down.failure).toBe("UNREACHABLE");

    const fake = createFakeOkta();
    const wrongIssuer = await checkHealth(fake.fetchImpl, {
      protocol: "OIDC",
      issuer: `${fake.issuer}/somewhere-else`,
      clientId: fake.clientId,
    });
    // Two different screens, two different people. "We can't reach it" is a
    // network or a URL typo; "it calls itself something else" is the wrong
    // authorization server pasted in. Reporting one generic failure sends an
    // admin to the wrong screen about half the time.
    expect(wrongIssuer.healthy).toBe(false);
    expect(wrongIssuer.failure).toBe("CONFIGURATION");
    expect(wrongIssuer.detail).toMatch(/calls itself/i);
  });
});
