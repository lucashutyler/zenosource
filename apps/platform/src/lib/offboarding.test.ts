import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { deactivateInternalUser, handOverOpenWork, reactivateInternalUser } from "./offboarding";
import { wipeTestDb } from "@/lib/testing/wipe-test-db";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("zenosource_test")) {
    throw new Error("Refusing to run — DATABASE_URL doesn't point at the test database.");
  }
});
afterAll(async () => db.$disconnect());
beforeEach(() => wipeTestDb(db));

async function scenario(options: { owners?: number } = {}) {
  const tenant = await db.tenant.create({ data: { name: "Acme", slug: "offboard-acme" } });
  const location = await db.location.create({
    data: { tenantId: tenant.id, name: "Chicago", code: "CHI" },
  });
  const owner = await db.internalUser.create({
    data: {
      tenantId: tenant.id,
      email: "owner@acme.test",
      name: "Olive Owner",
      role: "OWNER",
      passwordHash: "x",
      createdAt: new Date("2026-01-01"),
    },
  });
  if ((options.owners ?? 1) > 1) {
    await db.internalUser.create({
      data: {
        tenantId: tenant.id,
        email: "owner2@acme.test",
        name: "Second Owner",
        role: "OWNER",
        passwordHash: "x",
        createdAt: new Date("2026-02-01"),
      },
    });
  }
  const leaver = await db.internalUser.create({
    data: {
      tenantId: tenant.id,
      email: "casey@acme.test",
      name: "Casey Buyer",
      role: "MEMBER",
      sourceIntegrationId: "okta",
      externalRef: "00uCASEY",
    },
  });
  await db.internalUserLocation.create({
    data: { internalUserId: leaver.id, locationId: location.id, source: "DIRECTORY" },
  });

  const supplier = await db.supplier.create({ data: { tenantId: tenant.id, name: "Titan" } });
  const po = await db.purchaseOrder.create({
    data: { tenantId: tenant.id, supplierId: supplier.id, number: "P-10001", status: "DRAFT" },
  });
  const item = await db.actionItem.create({
    data: {
      tenantId: tenant.id,
      subjectType: "PURCHASE_ORDER",
      subjectId: po.id,
      actionType: "PO_ISSUE_DRAFT",
      ownerType: "INTERNAL_USER",
      internalOwnerId: leaver.id,
      accessToken: `offboard-${Math.random().toString(36).slice(2)}`,
    },
  });

  return { tenant, owner, leaver, location, item };
}

describe("a directory deactivation", () => {
  it("moves the open work to an owner rather than leaving it with nobody", async () => {
    const { owner, leaver, item } = await scenario();

    const result = await deactivateInternalUser({ db, userId: leaver.id, source: "DIRECTORY" });
    expect(result).toEqual(expect.objectContaining({ ok: true, moved: 1 }));

    const after = await db.actionItem.findUnique({ where: { id: item.id } });
    expect(after?.internalOwnerId).toBe(owner.id);
    expect(after?.status).toBe("OPEN");
    expect(after?.openedAt.getTime()).toBe(item.openedAt.getTime());
  });

  it("picks the oldest active owner, deterministically", async () => {
    const { owner, leaver } = await scenario({ owners: 2 });
    await deactivateInternalUser({ db, userId: leaver.id, source: "DIRECTORY" });
    const moved = await db.actionItem.findFirst({ where: { status: "OPEN" } });
    expect(moved?.internalOwnerId).toBe(owner.id);
  });

  it("does not hand the leaver's locations to the successor", async () => {
    const { owner, leaver } = await scenario();
    await deactivateInternalUser({ db, userId: leaver.id, source: "DIRECTORY" });

    expect(await db.internalUserLocation.count({ where: { internalUserId: owner.id } })).toBe(0);
    expect(await db.internalUserLocation.count({ where: { internalUserId: leaver.id } })).toBe(0);
  });

  it("hands the locations over when a person named the successor", async () => {
    const { owner, leaver, location } = await scenario({ owners: 2 });
    await deactivateInternalUser({
      db,
      userId: leaver.id,
      successorId: owner.id,
      source: "TEAM_PAGE",
      moveLocations: true,
    });
    const assignment = await db.internalUserLocation.findFirst({
      where: { internalUserId: owner.id, locationId: location.id },
    });
    expect(assignment?.source).toBe("MANUAL");
  });

  it("refuses to remove the last active owner", async () => {
    const { owner } = await scenario();
    const result = await deactivateInternalUser({ db, userId: owner.id, source: "DIRECTORY" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toMatch(/last active owner/i);

    const still = await db.internalUser.findUnique({ where: { id: owner.id } });
    expect(still?.status).toBe("ACTIVE");
  });

  it("records the refusal, because nothing else in the product would", async () => {
    const { owner, tenant } = await scenario();
    await deactivateInternalUser({ db, userId: owner.id, source: "DIRECTORY" });

    const events = await db.directoryEvent.findMany({ where: { tenantId: tenant.id } });
    expect(events.map((e) => e.kind)).toContain("OPERATION_REFUSED");
    expect(events[0].reason).toMatch(/last active owner/i);
  });

  it("demotes as well as deactivates, so coming back is not a promotion", async () => {
    const { leaver } = await scenario({ owners: 2 });
    await db.internalUser.update({ where: { id: leaver.id }, data: { role: "OWNER" } });

    await deactivateInternalUser({ db, userId: leaver.id, source: "DIRECTORY" });
    const after = await db.internalUser.findUnique({ where: { id: leaver.id } });
    expect(after?.status).toBe("DEACTIVATED");
    expect(after?.role).toBe("MEMBER");

    await reactivateInternalUser({ db, userId: leaver.id, source: "DIRECTORY" });
    const back = await db.internalUser.findUnique({ where: { id: leaver.id } });
    expect(back?.status).toBe("ACTIVE");
    expect(back?.role).toBe("MEMBER");
  });

  it("is idempotent, because a directory that sees an error retries forever", async () => {
    const { leaver } = await scenario();
    const first = await deactivateInternalUser({ db, userId: leaver.id, source: "DIRECTORY" });
    const second = await deactivateInternalUser({ db, userId: leaver.id, source: "DIRECTORY" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it("keeps the row, so every record that points at it survives", async () => {
    const { leaver } = await scenario();
    await deactivateInternalUser({ db, userId: leaver.id, source: "DIRECTORY" });
    expect(await db.internalUser.findUnique({ where: { id: leaver.id } })).not.toBeNull();
  });
});

describe("handOverOpenWork", () => {
  it("moves only what is still open", async () => {
    const { owner, leaver, tenant, item } = await scenario();
    const supplier = await db.supplier.findFirstOrThrow({ where: { tenantId: tenant.id } });
    const po = await db.purchaseOrder.create({
      data: {
        tenantId: tenant.id,
        supplierId: supplier.id,
        number: "P-10002",
        status: "CLOSED",
      },
    });
    const resolved = await db.actionItem.create({
      data: {
        tenantId: tenant.id,
        subjectType: "PURCHASE_ORDER",
        subjectId: po.id,
        actionType: "PO_CLOSE",
        ownerType: "INTERNAL_USER",
        internalOwnerId: leaver.id,
        status: "RESOLVED",
        accessToken: `offboard-resolved-${Math.random().toString(36).slice(2)}`,
      },
    });

    const { moved } = await handOverOpenWork({
      db,
      fromUserId: leaver.id,
      toUserId: owner.id,
      moveLocations: false,
    });
    expect(moved).toBe(1);
    expect((await db.actionItem.findUnique({ where: { id: item.id } }))?.internalOwnerId).toBe(owner.id);
    expect((await db.actionItem.findUnique({ where: { id: resolved.id } }))?.internalOwnerId).toBe(
      leaver.id
    );
  });
});
