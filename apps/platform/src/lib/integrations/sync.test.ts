import { describe, it, expect, beforeEach } from "vitest";
import { EpicorConnector } from "@zenosource/epicor";
import { db } from "@/lib/db";
import { wipeTestDb } from "@/lib/testing/wipe-test-db";
import { runSync } from "./sync";
import { sealSecrets } from "./secrets";

// The sync engine, against the real test database and the real Epicor
// connector — only the HTTP transport is scripted. Mocking the connector here
// would test the mock: the properties worth asserting are precisely the ones
// that emerge from mapper and upsert together, like a nightly re-sync leaving
// a supplier's acknowledgment alone.

process.env.INTEGRATION_SECRET_KEY ||= Buffer.alloc(32, 3).toString("base64");

type Row = Record<string, unknown>;

function connectorReturning(routes: { match: string; body: unknown }[]) {
  return new EpicorConnector({
    fetchImpl: async (url) => {
      const route = routes.find((r) => url.includes(r.match));
      const body = route ? route.body : { value: [] };
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
}

async function setup() {
  const tenant = await db.tenant.create({ data: { name: "Acme Manufacturing", slug: "sync-acme" } });
  await db.internalUser.create({
    data: {
      tenantId: tenant.id,
      email: `owner-${tenant.id}@example.com`,
      passwordHash: "x",
      name: "Dana Owner",
      role: "OWNER",
    },
  });
  const connection = await db.integrationConnection.create({
    data: {
      tenantId: tenant.id,
      integrationId: "epicor",
      status: "CONNECTED",
      config: {
        baseUrl: "https://kinetic.example.com/Prod",
        company: "EPIC06",
        authMode: "basic",
        verifiedCapabilities: ["supplier_sync", "po_sync", "price_list_sync", "po_suggestions"],
      },
      secretsSealed: sealSecrets({ apiKey: "k", username: "u", password: "p" }),
    },
  });
  return { tenant, connection };
}

const VENDOR: Row = { VendorNum: 42, Name: "Precision Parts", EMailAddress: "sam@precision.example" };

const PO_HEADER: Row = { PONum: 12345, VendorNum: 42, OpenOrder: true, Approve: true, OrderDate: "2026-08-01T00:00:00Z" };
const PO_DETAIL: Row = { PONum: 12345, POLine: 1, PartNum: "SKU-1001", LineDesc: "Bracket", IUM: "EA", OrderQty: 500, UnitCost: 8.755 };
const PO_RELEASE: Row = { PONum: 12345, POLine: 1, DueDate: "2026-08-14T00:00:00-07:00", OpenRelease: true };

const epicorRoutes = [
  { match: "VendorSvc", body: { value: [VENDOR] } },
  { match: "POSvc/POes", body: { value: [PO_HEADER] } },
  { match: "POSvc/PODetails", body: { value: [PO_DETAIL] } },
  { match: "POSvc/PORels", body: { value: [PO_RELEASE] } },
];

beforeEach(async () => {
  await wipeTestDb(db);
});

describe("mirroring an ERP", () => {
  it("imports suppliers and purchase orders, and gives each PO a ZenoSource number", async () => {
    const { tenant } = await setup();
    const summary = await runSync({
      tenantId: tenant.id,
      integrationId: "epicor",
      connector: connectorReturning(epicorRoutes),
    });

    expect(summary.backfill).toBe(true);
    expect(summary.results.find((r) => r.resource === "suppliers")?.created).toBe(1);
    expect(summary.results.find((r) => r.resource === "purchase_orders")?.created).toBe(1);

    const po = await db.purchaseOrder.findFirstOrThrow({ include: { lines: true } });
    // Epicor's own number is kept for reconciliation; the document number a
    // supplier reads down a phone is ours.
    expect(po.externalRef).toBe("12345");
    expect(po.number).toMatch(/^P-\d+$/);
    expect(po.status).toBe("ISSUED");
    expect(po.lines).toHaveLength(1);
    expect(Number(po.totalValue)).toBeCloseTo(500 * 8.755, 2);
  });

  it("stores a need-by date that reads back as the day Epicor meant", async () => {
    // The thirteen-call-site bug from Phase 1b Wave 1, entering through a
    // fourteenth door. Epicor sends 2026-08-14T00:00:00-07:00.
    const { tenant } = await setup();
    await runSync({ tenantId: tenant.id, integrationId: "epicor", connector: connectorReturning(epicorRoutes) });

    const line = await db.purchaseOrderLine.findFirstOrThrow();
    expect(line.needByDate?.toISOString()).toBe("2026-08-14T00:00:00.000Z");
  });

  it("is idempotent — a second run updates rather than duplicating", async () => {
    const { tenant } = await setup();
    const connector = connectorReturning(epicorRoutes);
    await runSync({ tenantId: tenant.id, integrationId: "epicor", connector });
    const summary = await runSync({ tenantId: tenant.id, integrationId: "epicor", connector });

    expect(await db.purchaseOrder.count()).toBe(1);
    expect(await db.supplier.count()).toBe(1);
    expect(summary.backfill).toBe(false);
    expect(summary.results.find((r) => r.resource === "purchase_orders")?.updated).toBe(1);
  });

  it("does not overwrite a supplier's acknowledgment on the next nightly sync", async () => {
    // The behaviour this product sells itself as preventing. Epicor cannot
    // see that a supplier answered through ZenoSource, so its "approved and
    // open" must not be read as evidence that they didn't.
    const { tenant } = await setup();
    const connector = connectorReturning(epicorRoutes);
    await runSync({ tenantId: tenant.id, integrationId: "epicor", connector });

    const po = await db.purchaseOrder.findFirstOrThrow();
    await db.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() },
    });
    await db.purchaseOrderLine.updateMany({
      where: { purchaseOrderId: po.id },
      data: { promiseDate: new Date("2026-08-20T00:00:00.000Z") },
    });

    await runSync({ tenantId: tenant.id, integrationId: "epicor", connector });

    const after = await db.purchaseOrder.findUniqueOrThrow({
      where: { id: po.id },
      include: { lines: true },
    });
    expect(after.status).toBe("ACKNOWLEDGED");
    // The supplier's committed date survives too — Epicor's is a buyer-side
    // expectation, ours is what they actually agreed to.
    expect(after.lines[0].promiseDate?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  it("accepts a close from the ERP and stops chasing", async () => {
    const { tenant } = await setup();
    await runSync({ tenantId: tenant.id, integrationId: "epicor", connector: connectorReturning(epicorRoutes) });

    const po = await db.purchaseOrder.findFirstOrThrow();
    await db.actionItem.create({
      data: {
        tenantId: tenant.id,
        subjectType: "PURCHASE_ORDER",
        subjectId: po.id,
        actionType: "PO_ACKNOWLEDGE",
        ownerType: "INTERNAL_USER",
        accessToken: `tok-${po.id}`,
      },
    });

    await runSync({
      tenantId: tenant.id,
      integrationId: "epicor",
      connector: connectorReturning([
        ...epicorRoutes.filter((r) => r.match !== "POSvc/POes"),
        { match: "POSvc/POes", body: { value: [{ ...PO_HEADER, OpenOrder: false }] } },
      ]),
    });

    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("CLOSED");
    expect(await db.actionItem.count({ where: { subjectId: po.id, status: "OPEN" } })).toBe(0);
  });

  it("skips a PO whose supplier isn't imported rather than guessing one", async () => {
    // Location and supplier are both boundaries a wrong guess crosses — a PO
    // on the wrong company's chase list is a real message to a real stranger.
    const { tenant } = await setup();
    const summary = await runSync({
      tenantId: tenant.id,
      integrationId: "epicor",
      connector: connectorReturning([
        { match: "VendorSvc", body: { value: [] } },
        ...epicorRoutes.filter((r) => r.match !== "VendorSvc"),
      ]),
    });

    expect(summary.results.find((r) => r.resource === "purchase_orders")?.skipped).toBe(1);
    expect(await db.purchaseOrder.count()).toBe(0);
  });

  it("resolves an Epicor plant code to a location, and leaves it null when it can't", async () => {
    const { tenant } = await setup();
    await db.location.create({ data: { tenantId: tenant.id, name: "Main Plant", code: "MAIN" } });

    await runSync({
      tenantId: tenant.id,
      integrationId: "epicor",
      connector: connectorReturning([
        ...epicorRoutes.filter((r) => r.match !== "POSvc/PORels"),
        { match: "POSvc/PORels", body: { value: [{ ...PO_RELEASE, Plant: "MAIN" }] } },
      ]),
    });

    const line = await db.purchaseOrderLine.findFirstOrThrow();
    expect(line.locationId).toBeTruthy();
  });

  it("leaves the location null when the plant code matches nothing", async () => {
    // A wrong location hands a MEMBER another site's orders. Null is visible
    // and fixable; a guess is neither.
    const { tenant } = await setup();
    await db.location.create({ data: { tenantId: tenant.id, name: "Main Plant", code: "MAIN" } });

    await runSync({
      tenantId: tenant.id,
      integrationId: "epicor",
      connector: connectorReturning([
        ...epicorRoutes.filter((r) => r.match !== "POSvc/PORels"),
        { match: "POSvc/PORels", body: { value: [{ ...PO_RELEASE, Plant: "NOT-A-PLANT" }] } },
      ]),
    });

    expect((await db.purchaseOrderLine.findFirstOrThrow()).locationId).toBeNull();
  });

  it("resolves plant codes for a whole batch in one query, not one per line", async () => {
    // Prisma's interactive transactions time out after five seconds by
    // default. A per-line lookup inside one means a 40-line order holds the
    // transaction open across 40 extra round trips — and loses the order.
    const { tenant } = await setup();
    await db.location.create({ data: { tenantId: tenant.id, name: "Main Plant", code: "MAIN" } });

    const lines = Array.from({ length: 30 }, (_, i) => ({
      ...PO_DETAIL,
      POLine: i + 1,
      PartNum: `SKU-${1000 + i}`,
    }));
    const releases = lines.map((l) => ({ ...PO_RELEASE, POLine: l.POLine, Plant: "MAIN" }));

    await runSync({
      tenantId: tenant.id,
      integrationId: "epicor",
      connector: connectorReturning([
        ...epicorRoutes.filter((r) => !["POSvc/PODetails", "POSvc/PORels"].includes(r.match)),
        { match: "POSvc/PODetails", body: { value: lines } },
        { match: "POSvc/PORels", body: { value: releases } },
      ]),
    });

    const stored = await db.purchaseOrderLine.findMany();
    expect(stored).toHaveLength(30);
    expect(stored.every((l) => l.locationId !== null)).toBe(true);
  });

  it("records a sync run per resource with a watermark for the next pull", async () => {
    const { tenant, connection } = await setup();
    await runSync({ tenantId: tenant.id, integrationId: "epicor", connector: connectorReturning(epicorRoutes) });

    const runs = await db.integrationSyncRun.findMany({ where: { connectionId: connection.id } });
    expect(runs.map((r) => r.resource).sort()).toEqual(
      ["po_suggestions", "price_lists", "purchase_orders", "suppliers"].sort()
    );
    expect(runs.every((r) => r.outcome === "SUCCEEDED")).toBe(true);
    expect(runs.every((r) => r.watermark !== null)).toBe(true);
  });

  it("skips resources the API key's Access Scope doesn't cover", async () => {
    const { tenant, connection } = await setup();
    await db.integrationConnection.update({
      where: { id: connection.id },
      data: {
        config: {
          baseUrl: "https://kinetic.example.com/Prod",
          company: "EPIC06",
          authMode: "basic",
          verifiedCapabilities: ["supplier_sync"],
        },
      },
    });

    const summary = await runSync({
      tenantId: tenant.id,
      integrationId: "epicor",
      connector: connectorReturning(epicorRoutes),
    });

    expect(summary.results.map((r) => r.resource)).toEqual(["suppliers"]);
    expect(await db.purchaseOrder.count()).toBe(0);
  });

  it("refuses to sync a degraded connection", async () => {
    const { tenant, connection } = await setup();
    await db.integrationConnection.update({ where: { id: connection.id }, data: { status: "DEGRADED" } });

    await expect(
      runSync({ tenantId: tenant.id, integrationId: "epicor", connector: connectorReturning(epicorRoutes) })
    ).rejects.toThrow(/DEGRADED/);
  });
});

describe("the chase guard on a first sync", () => {
  it("does not open supplier-owned items during a backfill", async () => {
    // A first sync at a real customer imports thousands of open orders.
    // Minting a supplier item for each would put every one into the next
    // digest — a mass mailing to hundreds of companies about orders they may
    // have already delivered, which is how a sending domain gets filtered.
    const { tenant } = await setup();
    await runSync({ tenantId: tenant.id, integrationId: "epicor", connector: connectorReturning(epicorRoutes) });

    const supplier = await db.supplier.findFirstOrThrow();
    await db.supplierContact.create({
      data: { supplierId: supplier.id, name: "Sam Supplier", email: "sam@precision.example" },
    });

    expect(await db.actionItem.count({ where: { ownerType: "EXTERNAL_USER" } })).toBe(0);
  });

  it("chases a newly issued PO on a later sync, once the backfill is behind us", async () => {
    const { tenant } = await setup();
    const connector = connectorReturning(epicorRoutes);
    await runSync({ tenantId: tenant.id, integrationId: "epicor", connector });

    const supplier = await db.supplier.findFirstOrThrow();
    await db.supplierContact.create({
      data: { supplierId: supplier.id, name: "Sam Supplier", email: "sam@precision.example" },
    });

    await runSync({
      tenantId: tenant.id,
      integrationId: "epicor",
      connector: connectorReturning([
        ...epicorRoutes.filter((r) => r.match !== "POSvc/POes"),
        {
          match: "POSvc/POes",
          body: { value: [PO_HEADER, { ...PO_HEADER, PONum: 12346 }] },
        },
        {
          match: "POSvc/PODetails",
          body: { value: [PO_DETAIL, { ...PO_DETAIL, PONum: 12346 }] },
        },
      ]),
    });

    const external = await db.actionItem.findMany({ where: { ownerType: "EXTERNAL_USER" } });
    expect(external).toHaveLength(1);
    expect(external[0].actionType).toBe("PO_ACKNOWLEDGE");
  });
});

describe("PO suggestions", () => {
  const SUGGESTION: Row = {
    SugNum: 9001,
    POLine: 1,
    VendorNum: 42,
    PartNum: "SKU-2050",
    PartDescription: "Housing",
    OrderQty: 250,
    DueDate: "2026-09-01T00:00:00Z",
    UnitCost: 12.5,
  };

  it("imports a suggestion and opens buyer-owned work for it", async () => {
    const { tenant } = await setup();
    await runSync({
      tenantId: tenant.id,
      integrationId: "epicor",
      connector: connectorReturning([
        { match: "VendorSvc", body: { value: [VENDOR] } },
        { match: "POSuggSvc", body: { value: [SUGGESTION] } },
      ]),
    });

    const suggestion = await db.pOSuggestion.findFirstOrThrow();
    expect(suggestion.status).toBe("OPEN");
    expect(suggestion.externalRef).toBe("9001-1");

    const item = await db.actionItem.findFirstOrThrow({ where: { subjectType: "PO_SUGGESTION" } });
    expect(item.actionType).toBe("PO_SUGGESTION_REVIEW");
    // Buyer-owned, so no chase guard applies — nothing here reaches a supplier.
    expect(item.ownerType).toBe("INTERNAL_USER");
  });

  it("supersedes a withdrawn suggestion and stops chasing it", async () => {
    // MRP reran and no longer proposes it. Chasing a buyer to act on demand
    // that no longer exists is the failure this product exists to prevent.
    const { tenant } = await setup();
    const routes = [
      { match: "VendorSvc", body: { value: [VENDOR] } },
      { match: "POSuggSvc", body: { value: [SUGGESTION] } },
    ];
    await runSync({ tenantId: tenant.id, integrationId: "epicor", connector: connectorReturning(routes) });

    await runSync({
      tenantId: tenant.id,
      integrationId: "epicor",
      connector: connectorReturning([
        { match: "VendorSvc", body: { value: [VENDOR] } },
        { match: "POSuggSvc", body: { value: [{ ...SUGGESTION, Ignore: true }] } },
      ]),
    });

    expect((await db.pOSuggestion.findFirstOrThrow()).status).toBe("SUPERSEDED");
    expect(await db.actionItem.count({ where: { subjectType: "PO_SUGGESTION", status: "OPEN" } })).toBe(0);
  });
});

describe("price lists", () => {
  it("reconciles vendor parts into a price list with a stepped schedule", async () => {
    const { tenant } = await setup();
    await runSync({
      tenantId: tenant.id,
      integrationId: "epicor",
      connector: connectorReturning([
        { match: "VendorSvc", body: { value: [VENDOR] } },
        {
          match: "VendPartSvc",
          body: {
            value: [
              {
                VendorNum: 42,
                PartNum: "SKU-2050",
                PartDescription: "Housing",
                PUM: "EA",
                BasePrice: 44,
                VendPBrks: [{ Quantity: 250, UnitPrice: 12.5 }],
              },
            ],
          },
        },
      ]),
    });

    const list = await db.priceList.findFirstOrThrow({
      include: { items: { include: { priceBreaks: true } } },
    });
    expect(list.number).toMatch(/^L-\d+$/);
    expect(list.items[0].priceBreaks.map((b) => b.minQuantity).sort((a, b) => a - b)).toEqual([1, 250]);
  });

  it("replaces a mirrored list wholesale, so a withdrawn break disappears", async () => {
    // A diff that only ever adds would leave a price the ERP retracted live
    // in the PO-create prefill forever.
    const { tenant } = await setup();
    const withBreak = {
      VendorNum: 42,
      PartNum: "SKU-2050",
      PUM: "EA",
      BasePrice: 44,
      VendPBrks: [{ Quantity: 250, UnitPrice: 12.5 }],
    };
    await runSync({
      tenantId: tenant.id,
      integrationId: "epicor",
      connector: connectorReturning([
        { match: "VendorSvc", body: { value: [VENDOR] } },
        { match: "VendPartSvc", body: { value: [withBreak] } },
      ]),
    });
    await runSync({
      tenantId: tenant.id,
      integrationId: "epicor",
      connector: connectorReturning([
        { match: "VendorSvc", body: { value: [VENDOR] } },
        { match: "VendPartSvc", body: { value: [{ ...withBreak, VendPBrks: [] }] } },
      ]),
    });

    const list = await db.priceList.findFirstOrThrow({
      include: { items: { include: { priceBreaks: true } } },
    });
    expect(await db.priceList.count()).toBe(1);
    expect(list.items[0].priceBreaks).toHaveLength(1);
    expect(list.items[0].priceBreaks[0].minQuantity).toBe(1);
  });
});
