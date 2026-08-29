import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { allocateDocumentNumber, normalizeDocumentNumberQuery } from "./document-number";
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

describe("allocateDocumentNumber", () => {
  it("hands out one sequence shared across document classes", async () => {
    const tenant = await db.tenant.create({ data: { name: "Numbering Co", slug: "numbering-co" } });

    const po = await allocateDocumentNumber(tenant.id, "P");
    const rfq = await allocateDocumentNumber(tenant.id, "Q");
    const list = await allocateDocumentNumber(tenant.id, "L");

    expect(po).toBe("P-10001");
    expect(rfq).toBe("Q-10002");
    expect(list).toBe("L-10003");
  });

  // The reason this is a single `UPDATE ... RETURNING` rather than
  // `MAX(number) + 1`: counting rows is a race in every concurrent case, and
  // the unique constraint is meant to be a backstop, not the mechanism.
  it("never hands the same number to two concurrent callers", async () => {
    const tenant = await db.tenant.create({ data: { name: "Racing Co", slug: "racing-co" } });

    const numbers = await Promise.all(
      Array.from({ length: 25 }, () => allocateDocumentNumber(tenant.id, "P"))
    );

    expect(new Set(numbers).size).toBe(25);
  });

  it("keeps sequences separate per tenant", async () => {
    const a = await db.tenant.create({ data: { name: "Tenant A", slug: "doc-tenant-a" } });
    const b = await db.tenant.create({ data: { name: "Tenant B", slug: "doc-tenant-b" } });

    expect(await allocateDocumentNumber(a.id, "P")).toBe("P-10001");
    expect(await allocateDocumentNumber(b.id, "P")).toBe("P-10001");
    expect(await allocateDocumentNumber(a.id, "P")).toBe("P-10002");
  });

  it("burns no number when the surrounding transaction rolls back", async () => {
    const tenant = await db.tenant.create({ data: { name: "Rollback Co", slug: "rollback-co" } });

    await expect(
      db.$transaction(async (tx) => {
        await allocateDocumentNumber(tenant.id, "P", tx);
        throw new Error("abandon");
      })
    ).rejects.toThrow("abandon");

    expect(await allocateDocumentNumber(tenant.id, "P")).toBe("P-10001");
  });

  it("refuses to allocate against a tenant that doesn't exist", async () => {
    await expect(allocateDocumentNumber("no-such-tenant", "P")).rejects.toThrow();
  });
});

describe("normalizeDocumentNumberQuery", () => {
  it("accepts every form a human actually pastes", () => {
    // Off an email, read down a phone, or typed from memory — all the same
    // document, and treating them as three different queries is the friction
    // that sends someone back to Outlook.
    expect(normalizeDocumentNumberQuery("P-10418")).toBe("10418");
    expect(normalizeDocumentNumberQuery("p 10418")).toBe("10418");
    expect(normalizeDocumentNumberQuery("10418")).toBe("10418");
    expect(normalizeDocumentNumberQuery("  Q-10422  ")).toBe("10422");
  });

  it("returns null for things that aren't document numbers", () => {
    expect(normalizeDocumentNumberQuery("SKU-2050")).toBeNull();
    expect(normalizeDocumentNumberQuery("Precision Parts")).toBeNull();
    expect(normalizeDocumentNumberQuery("")).toBeNull();
  });
});
