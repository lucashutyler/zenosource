import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { allLocationsBelongToTenant, hasLocationAccess } from "./access";
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

describe("allLocationsBelongToTenant", () => {
  it("is vacuously true for no location ids", async () => {
    expect(await allLocationsBelongToTenant([], "any-tenant")).toBe(true);
  });

  it("is true when every id belongs to the tenant", async () => {
    const tenant = await db.tenant.create({ data: { name: "Tenant A" } });
    const location = await db.location.create({
      data: { tenantId: tenant.id, name: "Plant A", code: "A-01" },
    });

    expect(await allLocationsBelongToTenant([location.id], tenant.id)).toBe(true);
  });

  it("is false when an id belongs to a different tenant", async () => {
    const tenantA = await db.tenant.create({ data: { name: "Tenant A" } });
    const tenantB = await db.tenant.create({ data: { name: "Tenant B" } });
    const otherTenantsLocation = await db.location.create({
      data: { tenantId: tenantB.id, name: "Plant B", code: "B-01" },
    });

    // This is the exact boundary a crafted form post would try to cross:
    // attaching another tenant's location id to this tenant's PO/RFQ line.
    expect(await allLocationsBelongToTenant([otherTenantsLocation.id], tenantA.id)).toBe(false);
  });

  it("is false when an id doesn't exist at all", async () => {
    const tenant = await db.tenant.create({ data: { name: "Tenant A" } });
    expect(await allLocationsBelongToTenant(["does-not-exist"], tenant.id)).toBe(false);
  });
});

describe("hasLocationAccess", () => {
  it("grants access when scope is undefined (OWNER)", () => {
    expect(hasLocationAccess(["loc-1"], undefined)).toBe(true);
    expect(hasLocationAccess([], undefined)).toBe(true);
  });

  it("grants access when at least one line location is in scope", () => {
    expect(hasLocationAccess(["loc-1", "loc-2"], ["loc-2"])).toBe(true);
  });

  it("denies access when no line location is in scope", () => {
    expect(hasLocationAccess(["loc-1", null], ["loc-2"])).toBe(false);
  });

  it("denies access when scope is empty (assigned to nothing)", () => {
    expect(hasLocationAccess(["loc-1"], [])).toBe(false);
  });
});
