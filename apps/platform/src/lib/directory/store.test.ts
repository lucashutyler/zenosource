import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { directoryStoreFor } from "./store";
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

async function scenario() {
  const tenant = await db.tenant.create({ data: { name: "Acme", slug: "store-acme" } });
  const connection = await db.integrationConnection.create({
    data: { tenantId: tenant.id, integrationId: "okta", status: "CONNECTED", config: {} },
  });
  const owner = await db.internalUser.create({
    data: {
      tenantId: tenant.id,
      email: "owner@acme.test",
      name: "Olive Owner",
      role: "OWNER",
      passwordHash: "x",
    },
  });
  const store = directoryStoreFor({
    tenantId: tenant.id,
    connectionId: connection.id,
    integrationId: "okta",
  });
  return { tenant, connection, owner, store };
}

describe("provisioning", () => {
  it("adopts an address that already has a password account", async () => {
    const { tenant, store } = await scenario();
    const existing = await db.internalUser.create({
      data: {
        tenantId: tenant.id,
        email: "casey@acme.test",
        name: "Casey Buyer",
        role: "OWNER",
        passwordHash: "a-real-hash",
      },
    });

    const created = await store.createUser({
      externalRef: "00uCASEY",
      email: "casey@acme.test",
      name: "Casey B",
    });
    expect(created).toEqual(expect.objectContaining({ email: "casey@acme.test" }));

    const after = await db.internalUser.findUniqueOrThrow({ where: { id: existing.id } });
    expect(await db.internalUser.count({ where: { tenantId: tenant.id } })).toBe(2);
    expect(after.externalRef).toBe("00uCASEY");
    expect(after.role).toBe("OWNER");
    expect(after.passwordHash).toBeNull();
  });

  it("is idempotent, because a directory that gets an error retries forever", async () => {
    const { store } = await scenario();
    await store.createUser({ externalRef: "00uNEW", email: "new@acme.test", name: "New" });
    const again = await store.createUser({
      externalRef: "00uNEW",
      email: "new@acme.test",
      name: "New Name",
    });
    expect(again).toEqual(expect.objectContaining({ name: "New Name" }));
  });

  it("refuses a second directory record claiming one address", async () => {
    const { store } = await scenario();
    await store.createUser({ externalRef: "00uONE", email: "shared@acme.test", name: "One" });
    const second = await store.createUser({
      externalRef: "00uTWO",
      email: "shared@acme.test",
      name: "Two",
    });
    expect(second).toEqual({ refused: expect.stringMatching(/already has that address/i) });
  });

  it("never lists people the directory did not create", async () => {
    const { store } = await scenario();
    await store.createUser({ externalRef: "00uNEW", email: "new@acme.test", name: "New" });
    const listed = await store.listUsers({ skip: 0, take: 100 });
    expect(listed.total).toBe(1);
    expect(listed.users[0].email).toBe("new@acme.test");
  });

  it("changes nothing on an address collision", async () => {
    const { tenant, store } = await scenario();
    await store.createUser({ externalRef: "00uA", email: "a@acme.test", name: "A" });
    await db.internalUser.create({
      data: { tenantId: tenant.id, email: "taken@acme.test", name: "Taken", passwordHash: "x" },
    });

    const result = await store.updateUser("00uA", { email: "taken@acme.test", name: "Renamed" });
    expect(result).toEqual({ refused: expect.stringMatching(/already has that address/i) });

    const untouched = await db.internalUser.findFirstOrThrow({ where: { externalRef: "00uA" } });
    expect(untouched.email).toBe("a@acme.test");
    expect(untouched.name).toBe("A");
  });
});

describe("deactivation through the directory", () => {
  it("refuses the last active owner and says why", async () => {
    const { tenant, store } = await scenario();
    await db.internalUser.updateMany({
      where: { tenantId: tenant.id, role: "OWNER" },
      data: { sourceIntegrationId: "okta", externalRef: "00uOWNER" },
    });

    const result = await store.setUserActive("00uOWNER", false);
    expect(result).toEqual({ refused: expect.stringMatching(/last active owner/i) });

    const events = await db.directoryEvent.findMany({ where: { kind: "OPERATION_REFUSED" } });
    expect(events).toHaveLength(1);
    expect(events[0].reason).toMatch(/last active owner/i);
  });

  it("deactivates rather than deletes, and reports it as inactive afterwards", async () => {
    const { store } = await scenario();
    await store.createUser({ externalRef: "00uNEW", email: "new@acme.test", name: "New" });

    const result = await store.setUserActive("00uNEW", false);
    expect(result).toEqual(expect.objectContaining({ active: false }));
    expect(await store.findUser("00uNEW")).toEqual(expect.objectContaining({ active: false }));
    expect(await db.internalUser.count({ where: { externalRef: "00uNEW" } })).toBe(1);
  });
});
