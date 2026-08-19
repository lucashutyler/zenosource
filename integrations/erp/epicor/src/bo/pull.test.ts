import { describe, it, expect } from "vitest";
import { EpicorConnector } from "../connector";
import { fakeKinetic, TEST_SESSION, type Route } from "../testing/fake-kinetic";
import type { CanonicalPurchaseOrder, CanonicalSupplier } from "../types";

function connectorFor(routes: Route[]) {
  const kinetic = fakeKinetic(routes);
  return { connector: new EpicorConnector({ fetchImpl: kinetic.fetchImpl }), kinetic };
}

async function drain<T>(batches: AsyncIterable<T[]>): Promise<T[]> {
  const all: T[] = [];
  for await (const batch of batches) all.push(...batch);
  return all;
}

describe("paging", () => {
  it("follows @odata.nextLink when the server sends one", async () => {
    let served = 0;
    const kinetic = fakeKinetic([]);
    const connector = new EpicorConnector({
      fetchImpl: async (url, init) => {
        kinetic.calls.push({ url, method: init.method, hadIdentity: true });
        served++;
        const body =
          served === 1
            ? {
                value: [{ VendorNum: 1, Name: "Acme" }],
                "@odata.nextLink": "https://kinetic.example.com/Prod/next-page",
              }
            : { value: [{ VendorNum: 2, Name: "Northline" }] };
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          async text() {
            return JSON.stringify(body);
          },
        };
      },
    });

    const suppliers = await drain<CanonicalSupplier>(connector.pullSuppliers(TEST_SESSION));
    expect(suppliers.map((s) => s.name)).toEqual(["Acme", "Northline"]);
    expect(kinetic.calls[1].url).toContain("next-page");
  });

  it("stops when a short page comes back, rather than looping on $skip forever", async () => {
    const { connector, kinetic } = connectorFor([
      { match: "VendorSvc", body: { value: [{ VendorNum: 1, Name: "Acme" }] } },
    ]);
    await drain(connector.pullSuppliers(TEST_SESSION));
    expect(kinetic.calls).toHaveLength(1);
  });

  it("passes a watermark as an OData filter on an incremental pull", async () => {
    const { connector, kinetic } = connectorFor([{ match: "VendorSvc", body: { value: [] } }]);
    await drain(connector.pullSuppliers(TEST_SESSION, { since: new Date("2026-08-01T00:00:00Z") }));
    expect(decodeURIComponent(kinetic.calls[0].url)).toContain("ChangeDate ge 2026-08-01T00:00:00Z");
    // %20, not +. URLSearchParams would emit `+`, which an OData server that
    // doesn't apply form rules to the query string reads as a literal plus
    // and rejects the whole filter over.
    expect(kinetic.calls[0].url).toContain("%20ge%20");
    expect(kinetic.calls[0].url).not.toContain("+ge+");
  });

  it("pulls suggestions in full even when a watermark exists", async () => {
    // MRP rewrites the whole set on each run. An incremental pull would miss
    // withdrawals, and a withdrawn suggestion left OPEN means chasing a buyer
    // to act on demand that no longer exists.
    const { connector, kinetic } = connectorFor([{ match: "POSuggSvc", body: { value: [] } }]);
    await drain(connector.pullPOSuggestions(TEST_SESSION, { since: new Date("2026-08-01T00:00:00Z") }));
    expect(decodeURIComponent(kinetic.calls[0].url)).not.toContain("ge 2026");
  });
});

describe("purchase-order pulls", () => {
  it("fetches children per page of headers, not per order", async () => {
    // One request per PO for its children is what makes ERP syncs take hours:
    // a 4,000-order first sync becomes 12,000 round trips.
    const { connector, kinetic } = connectorFor([
      {
        match: "POSvc/POes",
        body: {
          value: [
            { PONum: 1, VendorNum: 42, OpenOrder: true, Approve: true },
            { PONum: 2, VendorNum: 42, OpenOrder: true, Approve: true },
          ],
        },
      },
      {
        match: "POSvc/PODetails",
        body: {
          value: [
            { PONum: 1, POLine: 1, PartNum: "A", OrderQty: 1, UnitCost: 10 },
            { PONum: 2, POLine: 1, PartNum: "B", OrderQty: 2, UnitCost: 20 },
          ],
        },
      },
      { match: "POSvc/PORels", body: { value: [{ PONum: 1, POLine: 1, DueDate: "2026-09-09T00:00:00Z" }] } },
    ]);

    const orders = await drain<CanonicalPurchaseOrder>(connector.pullPurchaseOrders(TEST_SESSION));
    expect(orders).toHaveLength(2);

    // 1 header page + 1 details request + 1 releases request. Not 1 + 2 + 2.
    expect(kinetic.calls).toHaveLength(3);
    expect(orders.find((o) => o.externalRef === "1")!.lines[0].needByDate).toBe("2026-09-09");
    expect(orders.find((o) => o.externalRef === "2")!.lines[0].needByDate).toBeNull();
  });

  it("chunks the child filter so a large page can't blow the URL length cap", async () => {
    const headers = Array.from({ length: 120 }, (_, i) => ({
      PONum: i + 1,
      VendorNum: 42,
      OpenOrder: true,
      Approve: true,
    }));
    const { connector, kinetic } = connectorFor([
      { match: "POSvc/POes", body: { value: headers } },
      { match: "POSvc/PODetails", body: { value: [] } },
      { match: "POSvc/PORels", body: { value: [] } },
    ]);

    await drain(connector.pullPurchaseOrders(TEST_SESSION));

    // 120 orders at 50 per chunk = 3 chunks each for details and releases.
    expect(kinetic.calls.filter((c) => c.url.includes("PODetails"))).toHaveLength(3);
    expect(kinetic.calls.filter((c) => c.url.includes("PORels"))).toHaveLength(3);
  });
});
