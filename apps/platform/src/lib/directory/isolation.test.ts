import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { directoryStoreFor } from "./store";
import { issueDirectoryToken, resolveDirectoryToken, bearerFrom } from "@/lib/auth/directory-tokens";
import { wipeTestDb } from "@/lib/testing/wipe-test-db";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("zenosource_test")) {
    throw new Error("Refusing to run — DATABASE_URL doesn't point at the test database.");
  }
  process.env.INTEGRATION_SECRET_KEY ||= Buffer.alloc(32, 11).toString("base64");
});
afterAll(async () => db.$disconnect());
beforeEach(() => wipeTestDb(db));

async function organization(slug: string) {
  const tenant = await db.tenant.create({ data: { name: slug, slug } });
  const owner = await db.internalUser.create({
    data: {
      tenantId: tenant.id,
      email: `owner@${slug}.test`,
      name: "Owner",
      role: "OWNER",
      passwordHash: "x",
    },
  });
  const connection = await db.integrationConnection.create({
    data: {
      tenantId: tenant.id,
      integrationId: "okta",
      status: "CONNECTED",
      config: { protocol: "OIDC" },
      secretsSealed: null,
    },
  });
  const member = await db.internalUser.create({
    data: {
      tenantId: tenant.id,
      email: `person@${slug}.test`,
      name: "Person",
      role: "MEMBER",
      sourceIntegrationId: "okta",
      externalRef: "00uSHARED",
    },
  });
  const token = await issueDirectoryToken({
    tenantId: tenant.id,
    connectionId: connection.id,
    name: "test",
  });
  const store = directoryStoreFor({
    tenantId: tenant.id,
    connectionId: connection.id,
    integrationId: "okta",
  });
  return { tenant, owner, member, connection, token, store };
}

describe("one tenant's directory credential cannot reach another's", () => {
  it("resolves a token only to the organization that issued it", async () => {
    const a = await organization("iso-a");
    const b = await organization("iso-b");

    const resolvedA = await resolveDirectoryToken(a.token.plaintext);
    const resolvedB = await resolveDirectoryToken(b.token.plaintext);

    expect(resolvedA?.tenantId).toBe(a.tenant.id);
    expect(resolvedB?.tenantId).toBe(b.tenant.id);
    expect(resolvedA?.tenantId).not.toBe(resolvedB?.tenantId);
  });

  it("cannot see the other organization's people, even at the same directory id", async () => {
    const a = await organization("iso-a");
    await organization("iso-b");

    const seenByA = await a.store.findUser("00uSHARED");
    expect(seenByA?.email).toBe("person@iso-a.test");
    expect(seenByA?.email).not.toBe("person@iso-b.test");

    const listedByA = await a.store.listUsers({ skip: 0, take: 100 });
    expect(listedByA.users.map((u) => u.email)).toEqual(["person@iso-a.test"]);
    expect(listedByA.total).toBe(1);
  });

  it("cannot deactivate the other organization's person", async () => {
    const a = await organization("iso-a");
    const b = await organization("iso-b");

    await a.store.setUserActive("00uSHARED", false);

    const inA = await db.internalUser.findUnique({ where: { id: a.member.id } });
    const inB = await db.internalUser.findUnique({ where: { id: b.member.id } });
    expect(inA?.status).toBe("DEACTIVATED");
    expect(inB?.status).toBe("ACTIVE");
  });

  it("cannot find the other organization's people by email", async () => {
    const a = await organization("iso-a");
    await organization("iso-b");
    expect(await a.store.findUserByEmail("person@iso-b.test")).toBeNull();
  });

  it("writes an address change to its own row even when the address exists elsewhere", async () => {
    const a = await organization("iso-a");
    const b = await organization("iso-b");

    const updated = await a.store.updateUser("00uSHARED", { email: "person@iso-b.test" });
    expect(updated).toEqual(expect.objectContaining({ email: "person@iso-b.test" }));

    const inA = await db.internalUser.findUnique({ where: { id: a.member.id } });
    const inB = await db.internalUser.findUnique({ where: { id: b.member.id } });
    expect(inA?.email).toBe("person@iso-b.test");
    expect(inA?.tenantId).toBe(a.tenant.id);
    expect(inB?.email).toBe("person@iso-b.test");
    expect(inB?.tenantId).toBe(b.tenant.id);
    expect(inB?.updatedAt.getTime()).toBe(b.member.updatedAt.getTime());
  });

  it("cannot add the other organization's person to its own group", async () => {
    const a = await organization("iso-a");
    const b = await organization("iso-b");

    await a.store.upsertGroup({ externalRef: "00gX", displayName: "Buyers" });
    // Silently rather than as an error: an error would confirm the id exists somewhere.
    await a.store.addGroupMembers("00gX", ["00uSHARED"]);

    const members = await a.store.listGroupMembers("00gX");
    expect(members.map((m) => m.email)).toEqual(["person@iso-a.test"]);
    const bMemberships = await db.directoryGroupMember.count({
      where: { internalUserId: b.member.id },
    });
    expect(bMemberships).toBe(0);
  });

  it("cannot see the other organization's groups", async () => {
    const a = await organization("iso-a");
    const b = await organization("iso-b");

    await b.store.upsertGroup({ externalRef: "00gSECRET", displayName: "B's buyers" });

    expect(await a.store.findGroup("00gSECRET")).toBeNull();
    expect((await a.store.listGroups({ skip: 0, take: 100 })).total).toBe(0);
  });

  it("stops working the moment its connection is disconnected", async () => {
    const a = await organization("iso-a");
    expect(await resolveDirectoryToken(a.token.plaintext)).not.toBeNull();

    await db.integrationConnection.update({
      where: { id: a.connection.id },
      data: { status: "DISCONNECTED" },
    });
    expect(await resolveDirectoryToken(a.token.plaintext)).toBeNull();
  });

  it("keeps working while the connection is merely unhealthy", async () => {
    const a = await organization("iso-a");
    await db.integrationConnection.update({
      where: { id: a.connection.id },
      data: { status: "DEGRADED" },
    });
    expect(await resolveDirectoryToken(a.token.plaintext)).not.toBeNull();
  });
});

describe("the token itself", () => {
  it("is never stored in a form anything could give back", async () => {
    const a = await organization("iso-a");
    const row = await db.directoryToken.findUnique({ where: { id: a.token.id } });
    expect(row?.tokenHash).not.toContain(a.token.plaintext);
    expect(row?.tokenHash).toHaveLength(64);
    expect(row?.tokenHint).toMatch(/^•{6}/);
    expect(a.token.plaintext).toContain(row!.tokenHint.slice(-4));
  });

  it("is refused once revoked", async () => {
    const a = await organization("iso-a");
    await db.directoryToken.update({
      where: { id: a.token.id },
      data: { revokedAt: new Date() },
    });
    expect(await resolveDirectoryToken(a.token.plaintext)).toBeNull();
  });

  it("reads only a well-formed bearer header", () => {
    expect(bearerFrom("Bearer abc")).toBe("abc");
    expect(bearerFrom("bearer abc")).toBe("abc");
    expect(bearerFrom("Basic abc")).toBeNull();
    expect(bearerFrom("abc")).toBeNull();
    expect(bearerFrom(null)).toBeNull();
  });
});
