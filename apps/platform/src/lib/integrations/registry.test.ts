import { describe, it, expect } from "vitest";
import { CAPABILITIES, FEATURES, FEATURE_IDS, featureIsUnlocked, unlockedFeatures } from "./capabilities";
import type { Capability } from "./capabilities";
import { INTEGRATIONS, integrationsProviding } from "./registry";
import { isImplemented } from "./connectors";

// The executable version of the capability model, in the same spirit as
// lifecycle.test.ts is the executable version of "no unowned states".
//
// docs/architecture.md promises that "a new integration should only ever need
// to (a) implement its own subproject, (b) declare its capabilities, and (c)
// map its data into ZenoSource's canonical entities. It should never require
// changes to unrelated features." A promise like that decays quietly — the
// way it breaks is a feature quietly hard-coding `if (epicorConnected)`, or a
// capability that no longer unlocks anything after a refactor and sits in the
// list looking meaningful. These tests are what make the decay loud.

describe("the capability model holds together", () => {
  it("every feature's required capabilities are supplied by some integration", () => {
    for (const feature of FEATURE_IDS) {
      for (const capability of FEATURES[feature].requires) {
        const providers = integrationsProviding(capability);
        expect(
          providers.length,
          `feature "${feature}" requires "${capability}", which no integration provides — ` +
            `it can never unlock for any tenant`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("every declared capability unlocks at least one feature", () => {
    const required = new Set(FEATURE_IDS.flatMap((f) => FEATURES[f].requires));
    for (const capability of CAPABILITIES) {
      expect(
        required.has(capability),
        `capability "${capability}" is declared but no feature requires it — either a ` +
          `feature is missing from FEATURES, or the capability is dead vocabulary`
      ).toBe(true);
    }
  });

  it("every capability an integration declares is in the vocabulary", () => {
    const known = new Set<string>(CAPABILITIES);
    for (const integration of INTEGRATIONS) {
      for (const capability of integration.capabilities) {
        expect(known.has(capability), `${integration.id} declares unknown "${capability}"`).toBe(true);
      }
    }
  });

  it("integration ids are unique — one row per integration per tenant depends on it", () => {
    const ids = INTEGRATIONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every feature explains its locked state in the buyer's words, not ours", () => {
    for (const feature of FEATURE_IDS) {
      const because = FEATURES[feature].lockedBecause;
      expect(because.length, `${feature} has no lockedBecause`).toBeGreaterThan(20);
      // The copy a buyer reads must not contain our internal vocabulary.
      // "Missing capability po_suggestions" is a log line, not an explanation.
      expect(because).not.toMatch(/capabilit/i);
      for (const capability of CAPABILITIES) {
        expect(because, `${feature} leaks the raw capability id into user copy`).not.toContain(
          capability
        );
      }
    }
  });

  it("an integration is only offered when something implements it", () => {
    for (const integration of INTEGRATIONS) {
      if (integration.status === "available") {
        expect(
          isImplemented(integration.id),
          `${integration.id} is offered as available but no connector is registered for it — ` +
            `its connect form would fail on click`
        ).toBe(true);
      } else {
        expect(
          isImplemented(integration.id),
          `${integration.id} is described as forthcoming but is already built`
        ).toBe(false);
        expect(
          integration.plannedIn,
          `${integration.id} is planned but names no phase`
        ).toBeTruthy();
      }
    }
  });

  it("the registry is not single-vendor-shaped — it holds more than one type", () => {
    expect(new Set(INTEGRATIONS.map((i) => i.type)).size).toBeGreaterThan(1);
  });
});

describe("feature resolution", () => {
  it("requires every listed capability, not any of them", () => {
    expect(featureIsUnlocked("po-suggestions", ["po_suggestions"])).toBe(true);
    expect(featureIsUnlocked("po-suggestions", ["po_sync"])).toBe(false);
    expect(featureIsUnlocked("po-suggestions", [])).toBe(false);
  });

  it("unlocks nothing for a tenant with no connections", () => {
    expect(unlockedFeatures([])).toEqual([]);
  });

  it("connecting Epicor unlocks exactly the ERP features and no auth features", () => {
    const epicor = INTEGRATIONS.find((i) => i.id === "epicor")!;
    const unlocked = unlockedFeatures(epicor.capabilities as Capability[]);
    expect(unlocked).toContain("po-suggestions");
    expect(unlocked).toContain("erp-po-sync");
    expect(unlocked).not.toContain("sso-oidc");
    expect(unlocked).not.toContain("scim-provisioning");
  });

  it("connecting an identity provider unlocks no procurement features", () => {
    const okta = INTEGRATIONS.find((i) => i.id === "okta")!;
    const unlocked = unlockedFeatures(okta.capabilities as Capability[]);
    expect(unlocked).toContain("scim-provisioning");
    expect(unlocked).not.toContain("po-suggestions");
    expect(unlocked).not.toContain("erp-po-sync");
  });

  it("one identity-provider connection never verifies both sign-in protocols", () => {
    // A connection carries one protocol, which is why these are two features
    // rather than one `sso` with an any-of rule.
    expect(unlockedFeatures(["sso_oidc", "scim_provisioning"])).toEqual(
      expect.arrayContaining(["sso-oidc", "scim-provisioning"])
    );
    expect(unlockedFeatures(["sso_oidc", "scim_provisioning"])).not.toContain("sso-saml");
  });
});
