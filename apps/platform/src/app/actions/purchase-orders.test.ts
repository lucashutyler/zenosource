import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { acknowledgePOByToken, rejectPOByToken } from "./purchase-orders";
import { wipeTestDb } from "@/lib/testing/wipe-test-db";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("zenosource_test")) {
    throw new Error("Refusing to run — DATABASE_URL doesn't point at the test database.");
  }
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(() => wipeTestDb(db));

// Builds an ISSUED PO with a PENDING_ACKNOWLEDGMENT line and an OPEN
// PO_ACKNOWLEDGE item — the state a supplier's token normally targets.
async function buildIssuedPoFixture() {
  const tenant = await db.tenant.create({
    data: { name: "Token Guard Test Co", slug: "token-guard-test-co" },
  });
  const supplier = await db.supplier.create({ data: { tenantId: tenant.id, name: "Test Supplier" } });
  const contact = await db.supplierContact.create({
    data: { supplierId: supplier.id, name: "Sam", email: "sam@token-guard-test.example" },
  });
  const po = await db.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      number: `P-${Math.floor(Math.random() * 1_000_000)}`,
      supplierId: supplier.id,
      status: "ISSUED",
      lines: {
        create: [
          {
            lineNumber: 1,
            itemNumber: "SKU-1",
            description: "Test line",
            uom: "EA",
            quantity: 1,
            unitPrice: 1,
            status: "PENDING_ACKNOWLEDGMENT",
          },
        ],
      },
    },
  });
  const item = await db.actionItem.create({
    data: {
      tenantId: tenant.id,
      subjectType: "PURCHASE_ORDER",
      subjectId: po.id,
      actionType: "PO_ACKNOWLEDGE",
      ownerType: "EXTERNAL_USER",
      externalOwnerId: contact.id,
      accessToken: `token-${Math.random().toString(36).slice(2)}`,
    },
  });
  return { po, item };
}

describe("acknowledgePOByToken", () => {
  it("acknowledges an ISSUED PO and its pending lines", async () => {
    const { po, item } = await buildIssuedPoFixture();

    const result = await acknowledgePOByToken(item.accessToken);

    expect(result.error).toBeUndefined();
    const updated = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(updated.status).toBe("ACKNOWLEDGED");
  });

  it("does not resurrect a PO that changed status before the write landed", async () => {
    const { po, item } = await buildIssuedPoFixture();

    // Simulate the race this guard closes: the PO's status already moved
    // away from ISSUED (e.g. a concurrent cancellation won that race) by
    // the time this write is attempted, but the action item is still OPEN.
    await db.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    const result = await acknowledgePOByToken(item.accessToken);

    expect(result.error).toBeTruthy();
    const untouched = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(untouched.status).toBe("CANCELLED");

    // The action item still resolves — the supplier's click was recorded —
    // but it must not read as a successful acknowledgment.
    const resolvedItem = await db.actionItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(resolvedItem.status).toBe("RESOLVED");
  });
});

describe("rejectPOByToken", () => {
  it("rejects an ISSUED PO", async () => {
    const { po, item } = await buildIssuedPoFixture();

    const formData = new FormData();
    formData.set("reason", "wrong price");
    const result = await rejectPOByToken(item.accessToken, formData);

    expect(result.error).toBeUndefined();
    const updated = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(updated.status).toBe("REJECTED");
    expect(updated.rejectionReason).toBe("wrong price");
  });

  it("does not resurrect a PO that changed status before the write landed", async () => {
    const { po, item } = await buildIssuedPoFixture();

    await db.purchaseOrder.update({
      where: { id: po.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    const formData = new FormData();
    const result = await rejectPOByToken(item.accessToken, formData);

    expect(result.error).toBeTruthy();
    const untouched = await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(untouched.status).toBe("CANCELLED");
  });
});
