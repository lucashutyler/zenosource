import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { beginRequest, consumeRequest, newHandle } from "./sso-request";
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

async function tenant() {
  return db.tenant.create({ data: { name: "Acme", slug: "sso-request-acme" } });
}

async function start(tenantId: string) {
  const handle = newHandle();
  return beginRequest({
    handle,
    tenantId,
    integrationId: "okta",
    protocol: "OIDC",
    requestId: "req-1",
    nonce: "nonce-1",
    codeVerifier: "verifier-1",
    redirectTo: "/dashboard/purchase-orders",
  });
}

describe("an in-flight sign-in", () => {
  it("comes back once, with what the connector will need", async () => {
    const t = await tenant();
    const started = await start(t.id);

    const consumed = await consumeRequest(started.handle, started.cookieValue);
    expect(consumed?.requestId).toBe("req-1");
    expect(consumed?.nonce).toBe("nonce-1");
    expect(consumed?.codeVerifier).toBe("verifier-1");
    expect(consumed?.redirectTo).toBe("/dashboard/purchase-orders");
  });

  it("cannot be used twice", async () => {
    // A replayed callback is a replayed authorization code. The predicate is
    // inside the UPDATE, so this holds under concurrency and not merely in
    // sequence — see the next test.
    const t = await tenant();
    const started = await start(t.id);

    expect(await consumeRequest(started.handle, started.cookieValue)).not.toBeNull();
    expect(await consumeRequest(started.handle, started.cookieValue)).toBeNull();
  });

  it("is claimed by exactly one of many simultaneous callbacks", async () => {
    const t = await tenant();
    const started = await start(t.id);

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => consumeRequest(started.handle, started.cookieValue))
    );
    expect(attempts.filter(Boolean)).toHaveLength(1);
  });

  it("is refused in a browser that didn't start it", async () => {
    // Somebody who obtains a handle — from a log, a referrer, a shoulder —
    // must not be able to finish the sign-in in their own browser and be
    // signed in as the person who started it.
    const t = await tenant();
    const started = await start(t.id);

    expect(await consumeRequest(started.handle, "a-different-browsers-cookie")).toBeNull();
  });

  it("is spent even when the browser check fails, so a stolen handle is worth nothing", async () => {
    const t = await tenant();
    const started = await start(t.id);

    expect(await consumeRequest(started.handle, "wrong-cookie")).toBeNull();
    // The thief burned it. The real browser cannot use it either — which is
    // the right trade: one failed sign-in beats a usable stolen handle.
    expect(await consumeRequest(started.handle, started.cookieValue)).toBeNull();
  });

  it("is refused with no cookie at all", async () => {
    const t = await tenant();
    const started = await start(t.id);
    expect(await consumeRequest(started.handle, undefined)).toBeNull();
  });

  it("is refused once it has expired", async () => {
    const t = await tenant();
    const started = await start(t.id);
    await db.ssoAuthRequest.update({
      where: { handle: started.handle },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await consumeRequest(started.handle, started.cookieValue)).toBeNull();
  });

  it("sanitises where it will land, at store time", async () => {
    const t = await tenant();
    const handle = newHandle();
    const started = await beginRequest({
      handle,
      tenantId: t.id,
      integrationId: "okta",
      protocol: "SAML",
      requestId: "req-2",
      redirectTo: "https://evil.test/collect",
    });
    const consumed = await consumeRequest(started.handle, started.cookieValue);
    expect(consumed?.redirectTo).toBe("/dashboard");
  });

  it("never stores the browser cookie itself", async () => {
    const t = await tenant();
    const started = await start(t.id);
    const row = await db.ssoAuthRequest.findUnique({ where: { handle: started.handle } });
    expect(row?.browserBindingHash).not.toBe(started.cookieValue);
    expect(row?.browserBindingHash).toHaveLength(64);
  });
});
