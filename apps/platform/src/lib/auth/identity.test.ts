import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolveFederatedUser } from "./identity";
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

async function scenario(slug = "identity-acme") {
  const tenant = await db.tenant.create({ data: { name: "Acme", slug } });
  const connection = await db.integrationConnection.create({
    data: { tenantId: tenant.id, integrationId: "okta", status: "CONNECTED", config: {} },
  });
  return { tenant, connection };
}

function resolve(
  tenantId: string,
  connectionId: string,
  identity: { subject: string; email: string; name?: string }
) {
  return resolveFederatedUser({ tenantId, integrationId: "okta", connectionId, identity });
}

describe("turning a verified identity into somebody on the team", () => {
  it("provisions a member with no locations at all", async () => {
    const { tenant, connection } = await scenario();
    const result = await resolve(tenant.id, connection.id, {
      subject: "00uNEW",
      email: "New@Acme.test",
      name: "New Person",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const user = await db.internalUser.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.email).toBe("new@acme.test");
    expect(user.role).toBe("MEMBER");
    expect(user.passwordHash).toBeNull();
    // Being able to sign in is not being handed somebody's purchase orders.
    expect(await db.internalUserLocation.count({ where: { internalUserId: user.id } })).toBe(0);
  });

  it("adopts an existing password account, keeping its role and its history", async () => {
    // The ordinary case at a first federation: people have been using the
    // product for weeks before their IT department connects it.
    const { tenant, connection } = await scenario();
    const existing = await db.internalUser.create({
      data: {
        tenantId: tenant.id,
        email: "buyer@acme.test",
        name: "Jordan Buyer",
        role: "OWNER",
        passwordHash: "a-real-hash",
      },
    });

    const result = await resolve(tenant.id, connection.id, {
      subject: "00uJORDAN",
      email: "buyer@acme.test",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.userId).toBe(existing.id);

    const after = await db.internalUser.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after.role).toBe("OWNER");
    expect(after.externalRef).toBe("00uJORDAN");
    // The password goes: leaving it would keep a second, unmanaged way into an
    // account the directory now controls, so disabling somebody at the
    // identity provider would not actually disable them.
    expect(after.passwordHash).toBeNull();

    const events = await db.directoryEvent.findMany({ where: { tenantId: tenant.id } });
    expect(events.map((e) => e.kind)).toContain("USER_ADOPTED");
  });

  it("matches on the directory's stable key, never on the address", async () => {
    // A directory can change somebody's email. Matching on it would mean
    // renaming one account hands you another.
    const { tenant, connection } = await scenario();
    const first = await resolve(tenant.id, connection.id, {
      subject: "00uCASEY",
      email: "casey@acme.test",
    });
    expect(first.ok).toBe(true);

    const renamed = await resolve(tenant.id, connection.id, {
      subject: "00uCASEY",
      email: "casey.buyer@acme.test",
    });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok || !first.ok) return;
    expect(renamed.userId).toBe(first.userId);

    const after = await db.internalUser.findUniqueOrThrow({ where: { id: first.userId } });
    expect(after.email).toBe("casey.buyer@acme.test");
    expect(await db.internalUser.count({ where: { tenantId: tenant.id } })).toBe(1);
  });

  it("refuses somebody who has been deactivated here", async () => {
    const { tenant, connection } = await scenario();
    const created = await resolve(tenant.id, connection.id, {
      subject: "00uGONE",
      email: "gone@acme.test",
    });
    if (!created.ok) throw new Error("setup failed");
    await db.internalUser.update({
      where: { id: created.userId },
      data: { status: "DEACTIVATED" },
    });

    const again = await resolve(tenant.id, connection.id, {
      subject: "00uGONE",
      email: "gone@acme.test",
    });
    expect(again.ok).toBe(false);
  });

  it("never reaches into another organization, even for the same subject", async () => {
    // The single worst thing that could go wrong on this path: one customer's
    // identity provider minting a session for another customer's user.
    const a = await scenario("identity-a");
    const b = await scenario("identity-b");

    const inA = await resolve(a.tenant.id, a.connection.id, {
      subject: "00uSHARED",
      email: "person@shared.test",
    });
    const inB = await resolve(b.tenant.id, b.connection.id, {
      subject: "00uSHARED",
      email: "person@shared.test",
    });
    expect(inA.ok && inB.ok).toBe(true);
    if (!inA.ok || !inB.ok) return;

    expect(inA.userId).not.toBe(inB.userId);
    expect(inA.tenantId).toBe(a.tenant.id);
    expect(inB.tenantId).toBe(b.tenant.id);
    expect(await db.internalUser.count()).toBe(2);
  });

  it("does not overwrite an address that belongs to somebody else here", async () => {
    const { tenant, connection } = await scenario();
    await db.internalUser.create({
      data: { tenantId: tenant.id, email: "taken@acme.test", name: "Taken", passwordHash: "x" },
    });
    const mine = await resolve(tenant.id, connection.id, {
      subject: "00uME",
      email: "me@acme.test",
    });
    if (!mine.ok) throw new Error("setup failed");

    // Their directory renamed me to an address somebody else already has.
    const renamed = await resolve(tenant.id, connection.id, {
      subject: "00uME",
      email: "taken@acme.test",
    });
    // Signing in still works — refusing would lock me out over somebody else's
    // rename — but the stale address is left alone and the clash is recorded.
    expect(renamed.ok).toBe(true);
    const after = await db.internalUser.findUniqueOrThrow({ where: { id: mine.userId } });
    expect(after.email).toBe("me@acme.test");
    const refusals = await db.directoryEvent.findMany({ where: { kind: "OPERATION_REFUSED" } });
    expect(refusals).toHaveLength(1);
  });
});
