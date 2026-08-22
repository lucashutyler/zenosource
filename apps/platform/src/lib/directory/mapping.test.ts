import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { applyGrants, setGroupMapping } from "./mapping";
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
  const tenant = await db.tenant.create({ data: { name: "Acme", slug: "mapping-acme" } });
  const chicago = await db.location.create({
    data: { tenantId: tenant.id, name: "Chicago", code: "CHI" },
  });
  const austin = await db.location.create({
    data: { tenantId: tenant.id, name: "Austin", code: "AUS" },
  });
  const connection = await db.integrationConnection.create({
    data: { tenantId: tenant.id, integrationId: "okta", status: "CONNECTED", config: {} },
  });
  const person = await db.internalUser.create({
    data: {
      tenantId: tenant.id,
      email: "casey@acme.test",
      name: "Casey",
      role: "MEMBER",
      sourceIntegrationId: "okta",
      externalRef: "00uCASEY",
    },
  });
  const store = directoryStoreFor({
    tenantId: tenant.id,
    connectionId: connection.id,
    integrationId: "okta",
  });
  await store.upsertGroup({ externalRef: "00gBUYERS", displayName: "Buyers" });
  await store.addGroupMembers("00gBUYERS", ["00uCASEY"]);
  const group = await db.directoryGroup.findFirstOrThrow({ where: { externalRef: "00gBUYERS" } });

  return { tenant, chicago, austin, connection, person, store, group };
}

describe("a pushed group", () => {
  it("grants nothing until somebody here says what it means", async () => {
    const { person, group } = await scenario();
    expect(group.mappedRole).toBeNull();
    expect(await db.internalUserLocation.count({ where: { internalUserId: person.id } })).toBe(0);
  });

  it("reaches the people already in it when it is mapped", async () => {
    // A mapping made on Tuesday has to reach Monday's members, or an owner
    // maps a group, sees nothing happen, and maps it again.
    const { tenant, person, group, chicago } = await scenario();
    const result = await setGroupMapping({
      db,
      tenantId: tenant.id,
      groupId: group.id,
      role: "MEMBER",
      locationIds: [chicago.id],
    });
    expect(result.ok).toBe(true);

    const grants = await db.internalUserLocation.findMany({ where: { internalUserId: person.id } });
    expect(grants).toHaveLength(1);
    expect(grants[0].locationId).toBe(chicago.id);
    expect(grants[0].source).toBe("DIRECTORY");
    expect(grants[0].grantedByGroupId).toBe(group.id);
  });

  it("can never grant owner, however the request is made", async () => {
    const { tenant, group } = await scenario();
    const result = await setGroupMapping({
      db,
      tenantId: tenant.id,
      groupId: group.id,
      // Crafted past the form, which only offers member or nothing.
      role: "OWNER" as unknown as "MEMBER",
      locationIds: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toMatch(/can't grant owner/i);

    const after = await db.directoryGroup.findUnique({ where: { id: group.id } });
    expect(after?.mappedRole).toBeNull();
    const events = await db.directoryEvent.findMany({ where: { kind: "OPERATION_REFUSED" } });
    expect(events).toHaveLength(1);
  });

  it("refuses a location from another organization", async () => {
    const { tenant, group } = await scenario();
    const other = await db.tenant.create({ data: { name: "Other", slug: "mapping-other" } });
    const theirs = await db.location.create({
      data: { tenantId: other.id, name: "Theirs", code: "THR" },
    });

    const result = await setGroupMapping({
      db,
      tenantId: tenant.id,
      groupId: group.id,
      role: "MEMBER",
      locationIds: [theirs.id],
    });
    expect(result.ok).toBe(false);
  });

  it("withdraws only what it granted when it stops applying", async () => {
    const { tenant, person, group, chicago, austin, store } = await scenario();
    await setGroupMapping({
      db,
      tenantId: tenant.id,
      groupId: group.id,
      role: "MEMBER",
      locationIds: [chicago.id],
    });
    // A hand-made grant alongside it.
    await db.internalUserLocation.create({
      data: { internalUserId: person.id, locationId: austin.id, source: "MANUAL" },
    });

    await store.removeGroupMembers("00gBUYERS", ["00uCASEY"]);

    const left = await db.internalUserLocation.findMany({ where: { internalUserId: person.id } });
    // The group's grant is gone; the one an owner made by hand is not. Losing
    // it silently is how somebody's board empties overnight for a reason
    // nobody can reconstruct.
    expect(left.map((l) => l.locationId)).toEqual([austin.id]);
    expect(left[0].source).toBe("MANUAL");
  });

  it("never converts a hand-made grant into one a group can take away", async () => {
    const { tenant, person, group, chicago } = await scenario();
    await db.internalUserLocation.create({
      data: { internalUserId: person.id, locationId: chicago.id, source: "MANUAL" },
    });
    await setGroupMapping({
      db,
      tenantId: tenant.id,
      groupId: group.id,
      role: "MEMBER",
      locationIds: [chicago.id],
    });

    const row = await db.internalUserLocation.findFirstOrThrow({
      where: { internalUserId: person.id, locationId: chicago.id },
    });
    expect(row.source).toBe("MANUAL");

    await setGroupMapping({ db, tenantId: tenant.id, groupId: group.id, role: null, locationIds: [] });
    expect(
      await db.internalUserLocation.count({ where: { internalUserId: person.id } })
    ).toBe(1);
  });

  it("takes its grants with it when the group is deleted", async () => {
    const { tenant, person, group, chicago, store } = await scenario();
    await setGroupMapping({
      db,
      tenantId: tenant.id,
      groupId: group.id,
      role: "MEMBER",
      locationIds: [chicago.id],
    });
    await store.deleteGroup("00gBUYERS");

    expect(await db.internalUserLocation.count({ where: { internalUserId: person.id } })).toBe(0);
    // The people stay; only the group goes.
    expect(await db.internalUser.findUnique({ where: { id: person.id } })).not.toBeNull();
  });

  it("never demotes an existing owner", async () => {
    const { tenant, person, group, chicago } = await scenario();
    await db.internalUser.update({ where: { id: person.id }, data: { role: "OWNER" } });
    await setGroupMapping({
      db,
      tenantId: tenant.id,
      groupId: group.id,
      role: "MEMBER",
      locationIds: [chicago.id],
    });

    const outcome = await applyGrants({ db, tenantId: tenant.id, internalUserId: person.id });
    expect(outcome.role).toBeNull();
    const after = await db.internalUser.findUnique({ where: { id: person.id } });
    expect(after?.role).toBe("OWNER");
  });
});
