import { describe, it, expect } from "vitest";
import { EpicorConnector } from "./connector";
import { fakeKinetic, TEST_SESSION, type Route } from "./testing/fake-kinetic";

function connectorFor(routes: Route[]) {
  const kinetic = fakeKinetic(routes);
  return { connector: new EpicorConnector({ fetchImpl: kinetic.fetchImpl }), kinetic };
}

describe("write-back through an Updatable BAQ", () => {
  it("writes through BaqSvc, not a raw business object", async () => {
    const { connector, kinetic } = connectorFor([{ match: "BaqSvc", body: {} }]);
    const result = await connector.pushPurchaseOrderChange(TEST_SESSION, {
      poExternalRef: "12345",
      lineExternalRef: "12345-2",
      promiseDate: "2026-09-14",
      acknowledged: true,
    });

    expect(result.ok).toBe(true);
    expect(kinetic.calls[0].url).toContain("/BaqSvc/ZS-PO-Ack/Data");
    expect(kinetic.calls[0].method).toBe("PATCH");
    const body = JSON.parse(kinetic.calls[0].body!);
    expect(body.value[0]).toMatchObject({ PONum: "12345", POLine: 2, PromiseDt: "2026-09-14" });
  });

  it("sends only the fields the supplier committed to", async () => {
    // Pushing our whole view of the line would overwrite buyer-side edits
    // made in Epicor since the last sync. The ERP owns the fields it owns.
    const { connector, kinetic } = connectorFor([{ match: "BaqSvc", body: {} }]);
    await connector.pushPurchaseOrderChange(TEST_SESSION, {
      poExternalRef: "12345",
      lineExternalRef: "12345-2",
      promiseDate: "2026-09-14",
    });
    const body = JSON.parse(kinetic.calls[0].body!);
    expect(Object.keys(body.value[0]).sort()).toEqual(["Company", "POLine", "PONum", "PromiseDt"]);
  });

  it("makes no call at all when there is nothing to write", async () => {
    const { connector, kinetic } = connectorFor([{ match: "BaqSvc", body: {} }]);
    const result = await connector.pushPurchaseOrderChange(TEST_SESSION, {
      poExternalRef: "12345",
      lineExternalRef: "12345-2",
    });
    expect(result.ok).toBe(true);
    expect(kinetic.calls).toHaveLength(0);
  });

  it("explains a missing BAQ instead of reporting a bare 404", async () => {
    const { connector } = connectorFor([{ match: "BaqSvc", status: 404, body: {} }]);
    const result = await connector.pushPurchaseOrderChange(TEST_SESSION, {
      poExternalRef: "1",
      lineExternalRef: "1-1",
      acknowledged: true,
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/no BAQ named "ZS-PO-Ack"/);
    expect(result.detail).toMatch(/import the ZenoSource BAQ package/i);
  });

  it("honours a per-connection BAQ id override", async () => {
    const { connector, kinetic } = connectorFor([{ match: "BaqSvc", body: {} }]);
    await connector.pushPurchaseOrderChange(
      { ...TEST_SESSION, config: { ...TEST_SESSION.config, baqs: { purchaseOrderAcknowledgment: "ACME-Ack" } } },
      { poExternalRef: "1", lineExternalRef: "1-1", acknowledged: true }
    );
    expect(kinetic.calls[0].url).toContain("/BaqSvc/ACME-Ack/Data");
  });
});

describe("suggestion decisions", () => {
  it("routes an accept through the requisition path and reports the requisition", async () => {
    const { connector, kinetic } = connectorFor([
      { match: "ZS-PO-Sugg-Decision", body: { value: [{ ReqNum: 5501 }] } },
    ]);
    const result = await connector.pushSuggestionDecision(TEST_SESSION, {
      suggestionExternalRef: "9001-1",
      decision: "ACCEPT",
      quantity: "250.0000",
    });

    expect(result.ok).toBe(true);
    expect(result.externalRef).toBe("5501");
    // It is not a PO yet, and saying so is the difference between a buyer
    // who waits and a buyer who raises it twice.
    expect(result.detail).toMatch(/requisition 5501/);
    expect(result.detail).toMatch(/approval path/i);
    expect(JSON.parse(kinetic.calls[0].body!).value[0]).toMatchObject({ SugNum: "9001", POLine: 1 });
  });

  it("never writes to the suggestion itself", async () => {
    // Epicor rejects that outright ("Suggestion is no longer valid") — the
    // pipeline is demand -> MRP -> requisition -> suggestion -> firm PO, and
    // suggestions cannot be created or updated over REST.
    const { connector, kinetic } = connectorFor([{ match: "BaqSvc", body: { value: [] } }]);
    await connector.pushSuggestionDecision(TEST_SESSION, {
      suggestionExternalRef: "9001-1",
      decision: "ACCEPT",
    });
    expect(kinetic.calls.every((c) => !c.url.includes("POSuggSvc"))).toBe(true);
  });

  it("records a rejection locally and says plainly that Epicor keeps nothing", async () => {
    const { connector, kinetic } = connectorFor([{ match: "BaqSvc", body: {} }]);
    const result = await connector.pushSuggestionDecision(TEST_SESSION, {
      suggestionExternalRef: "9001-1",
      decision: "REJECT",
      reason: "Stock on hand covers it",
    });
    expect(result.ok).toBe(true);
    expect(kinetic.calls).toHaveLength(0);
    expect(result.detail).toMatch(/propose it again/i);
  });
});
