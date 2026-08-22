import { describe, it, expect } from "vitest";
import { epicorConnector, EPICOR_CAPABILITIES } from "@zenosource/epicor";
import { oktaConnector, OKTA_CAPABILITIES } from "@zenosource/okta";
import type { ErpConnector } from "./contract";
import type { IdpConnector } from "./idp-contract";
import { getIntegration } from "./registry";

// The seam between the platform and an integration subproject, asserted.
//
// The type-level half of this already happened at build time in
// connectors.ts. What's left is the part types can't see: that the connector
// and the registry agree about what Epicor claims to do. Those are two
// separate declarations in two separate packages — the registry entry the
// platform gates features on, and the capability list the connector's health
// check probes — and nothing but this test stops them diverging. Diverged,
// they fail quietly: a capability declared in the registry but never probed
// is a feature that unlocks and then renders empty.

describe("the Epicor connector conforms to the platform's contract", () => {
  it("satisfies ErpConnector structurally", () => {
    // The assignment is the assertion; it cannot compile otherwise.
    const connector: ErpConnector = epicorConnector;
    expect(connector.integrationId).toBe("epicor");
  });

  it("implements every method the contract requires", () => {
    for (const method of [
      "parseConfig",
      "checkHealth",
      "pullSuppliers",
      "pullPurchaseOrders",
      "pullPriceLists",
      "pullPOSuggestions",
      "pushPurchaseOrderChange",
      "pushSuggestionDecision",
    ] as const) {
      expect(typeof epicorConnector[method], `${method} is missing`).toBe("function");
    }
  });

  it("probes exactly the capabilities the registry says it provides", () => {
    const declared = getIntegration("epicor")!.capabilities;
    expect([...EPICOR_CAPABILITIES].sort()).toEqual([...declared].sort());
  });

  it("keeps its id in step with the registry", () => {
    expect(getIntegration(epicorConnector.integrationId)).toBeTruthy();
  });
});

describe("the Okta connector conforms to the platform's contract", () => {
  it("satisfies IdpConnector structurally", () => {
    // Same assertion as Epicor's above, against the other contract. An
    // identity provider and an ERP have almost nothing in common, which is
    // why there are two contracts and two of these — a union would make this
    // line compile while checking nothing.
    const connector: IdpConnector = oktaConnector;
    expect(connector.integrationId).toBe("okta");
  });

  it("implements every method the contract requires", () => {
    for (const method of [
      "parseConfig",
      "checkHealth",
      "readHandle",
      "beginSignIn",
      "completeSignIn",
      "describeServiceProvider",
      "handleDirectoryRequest",
    ] as const) {
      expect(typeof oktaConnector[method], `${method} is missing`).toBe("function");
    }
  });

  it("probes exactly the capabilities the registry says it provides", () => {
    const declared = getIntegration("okta")!.capabilities;
    expect([...OKTA_CAPABILITIES].sort()).toEqual([...declared].sort());
  });

  it("keeps its id in step with the registry", () => {
    expect(getIntegration(oktaConnector.integrationId)).toBeTruthy();
  });

  it("has no ERP methods, so nothing can call it as one by accident", () => {
    const asRecord = oktaConnector as unknown as Record<string, unknown>;
    for (const method of ["pullPurchaseOrders", "pushSuggestionDecision", "pullSuppliers"]) {
      expect(asRecord[method], `${method} should not exist on an identity connector`).toBeUndefined();
    }
  });
});
