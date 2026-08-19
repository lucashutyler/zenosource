import { describe, it, expect } from "vitest";
import { EpicorConnector } from "./connector";
import { fakeKinetic, TEST_SESSION, type Route } from "./testing/fake-kinetic";

// The headline requirement of Phase 2's second bullet: "connection health
// check that distinguishes API-key vs. identity-credential failures."
//
// It matters because the two credentials are fixed by different people in
// different screens. Reporting "auth failed" sends a buyer's IT admin to the
// wrong one about half the time, and each wrong guess is a support cycle
// during onboarding — the exact moment a customer is deciding whether this
// product is competent.

function connectorFor(routes: Route[]) {
  const kinetic = fakeKinetic(routes);
  return { connector: new EpicorConnector({ fetchImpl: kinetic.fetchImpl }), kinetic };
}

describe("connection health", () => {
  it("is healthy when a service answers, and reports which capabilities are live", async () => {
    const { connector } = connectorFor([{ match: "/api/v2/odata/", body: { value: [{}] } }]);
    const health = await connector.checkHealth(TEST_SESSION);

    expect(health.healthy).toBe(true);
    expect(health.failure).toBe("NONE");
    expect(health.verifiedCapabilities).toEqual(
      expect.arrayContaining(["po_sync", "po_suggestions", "supplier_sync", "price_list_sync"])
    );
  });

  it("names the API key when Epicor's gateway says so", async () => {
    const { connector } = connectorFor([
      { match: "/api/v2/odata/", status: 401, body: { message: "Invalid API Key" } },
    ]);
    const health = await connector.checkHealth(TEST_SESSION);

    expect(health.healthy).toBe(false);
    expect(health.failure).toBe("API_KEY");
    // The message has to name the screen — that's the entire point.
    expect(health.detail).toMatch(/API Key Maintenance/i);
  });

  it("names the identity when the failure is authentication, and says the key is fine", async () => {
    const { connector } = connectorFor([
      { match: "/api/v2/odata/", status: 401, body: { message: "Authentication failed" } },
    ]);
    const health = await connector.checkHealth(TEST_SESSION);

    expect(health.failure).toBe("IDENTITY");
    expect(health.detail).toMatch(/does not need changing/i);
  });

  it("probes without the identity header to settle an unmarked 401", async () => {
    // A bare 401 with no marker text: unresolvable from the response alone.
    // Kinetic checks the API key before authentication runs, so re-asking
    // without an identity is a question with only one possible answer —
    // if the key were good we'd get an authentication challenge instead.
    const { connector, kinetic } = connectorFor([
      { match: "/api/v2/odata/", requiresIdentity: true, status: 401, body: { message: "Unauthorized" } },
      {
        match: "/api/v2/odata/",
        requiresIdentity: false,
        status: 401,
        body: { message: "API key is required" },
      },
    ]);
    const health = await connector.checkHealth(TEST_SESSION);

    expect(health.failure).toBe("API_KEY");
    expect(kinetic.calls.some((c) => !c.hadIdentity)).toBe(true);
  });

  it("settles the same unmarked 401 the other way when the key clearly passes", async () => {
    const { connector } = connectorFor([
      { match: "/api/v2/odata/", requiresIdentity: true, status: 401, body: { message: "Unauthorized" } },
      {
        match: "/api/v2/odata/",
        requiresIdentity: false,
        status: 401,
        body: { message: "Please sign in" },
        headers: { "www-authenticate": 'Basic realm="Epicor"' },
      },
    ]);
    expect((await connector.checkHealth(TEST_SESSION)).failure).toBe("IDENTITY");
  });

  it("calls a 500 unreachable, not an auth problem — re-entering a password won't help", async () => {
    const { connector } = connectorFor([
      { match: "/api/v2/odata/", status: 503, body: "service unavailable" },
    ]);
    const health = await connector.checkHealth(TEST_SESSION);

    expect(health.failure).toBe("UNREACHABLE");
    expect(health.detail).toMatch(/Nothing is wrong with the credentials/i);
  });

  it("calls a 404 configuration — wrong company or URL, not wrong credentials", async () => {
    const { connector } = connectorFor([{ match: "/api/v2/odata/", status: 404, body: {} }]);
    const health = await connector.checkHealth(TEST_SESSION);

    expect(health.failure).toBe("CONFIGURATION");
    expect(health.detail).toMatch(/Company ID/i);
  });

  it("stays healthy on a partial Access Scope, and grants only what answered", async () => {
    // The normal case at a real customer: an API key scoped to some services
    // and not others. All-or-nothing here would either block a working
    // connection or unlock a PO Suggestions screen that is empty forever.
    const { connector } = connectorFor([
      { match: "POSuggSvc", status: 403, body: { message: "Access scope does not include this service" } },
      { match: "/api/v2/odata/", body: { value: [{}] } },
    ]);
    const health = await connector.checkHealth(TEST_SESSION);

    expect(health.healthy).toBe(true);
    expect(health.verifiedCapabilities).toContain("po_sync");
    expect(health.verifiedCapabilities).not.toContain("po_suggestions");
    expect(health.detail).toMatch(/Access Scope/i);
  });
});
