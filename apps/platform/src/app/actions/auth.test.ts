import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { wipeTestDb } from "@/lib/testing/wipe-test-db";

// createSession writes a cookie, which needs a request context Vitest doesn't
// have; redirect() throws a framework-internal signal.
const created: { internalUserId: string; tenantId: string }[] = [];
vi.mock("@/lib/session", () => ({
  createSession: async (payload: { internalUserId: string; tenantId: string }) => {
    created.push(payload);
  },
  deleteSession: async () => {},
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

const { login } = await import("./auth");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("zenosource_test")) {
    throw new Error("Refusing to run — DATABASE_URL doesn't point at the test database.");
  }
});
afterAll(async () => db.$disconnect());
beforeEach(async () => {
  await wipeTestDb(db);
  created.length = 0;
});

const PASSWORD = "correct-horse-battery";

function form(email: string, password: string): FormData {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  return data;
}

async function person(options: {
  slug: string;
  email: string;
  password?: string | null;
  status?: "ACTIVE" | "DEACTIVATED";
}) {
  const tenant = await db.tenant.create({ data: { name: options.slug, slug: options.slug } });
  const user = await db.internalUser.create({
    data: {
      tenantId: tenant.id,
      email: options.email,
      name: "Someone",
      passwordHash:
        options.password === null ? null : await bcrypt.hash(options.password ?? PASSWORD, 10),
      status: options.status ?? "ACTIVE",
    },
  });
  return { tenant, user };
}

/** login() redirects on success, which the mock turns into a throw. */
async function attempt(email: string, password: string) {
  try {
    return await login(undefined, form(email, password));
  } catch (thrown) {
    if (thrown instanceof Error && thrown.message === "NEXT_REDIRECT") return "redirected";
    throw thrown;
  }
}

describe("signing in with a password", () => {
  it("signs in the right person", async () => {
    const { tenant, user } = await person({ slug: "auth-a", email: "buyer@acme.test" });
    expect(await attempt("buyer@acme.test", PASSWORD)).toBe("redirected");
    expect(created).toEqual([{ internalUserId: user.id, tenantId: tenant.id }]);
  });

  it("finds the right organization when one address exists in two", async () => {
    // Email is unique per tenant, not globally: taking the first match signs
    // somebody into the wrong company's purchase orders.
    const a = await person({ slug: "auth-a", email: "shared@example.test", password: "password-a" });
    const b = await person({ slug: "auth-b", email: "shared@example.test", password: "password-b" });

    expect(await attempt("shared@example.test", "password-b")).toBe("redirected");
    expect(created).toEqual([{ internalUserId: b.user.id, tenantId: b.tenant.id }]);

    created.length = 0;
    expect(await attempt("shared@example.test", "password-a")).toBe("redirected");
    expect(created).toEqual([{ internalUserId: a.user.id, tenantId: a.tenant.id }]);
  });

  it("refuses somebody who has been deactivated", async () => {
    await person({ slug: "auth-a", email: "gone@acme.test", status: "DEACTIVATED" });
    const result = await attempt("gone@acme.test", PASSWORD);
    expect(result).toEqual({ error: "Invalid email or password." });
    expect(created).toHaveLength(0);
  });

  it("refuses a federated account with no password rather than throwing on a null hash", async () => {
    // Treating a null hash as a match makes every federated user passwordless.
    await person({ slug: "auth-a", email: "federated@acme.test", password: null });
    const result = await attempt("federated@acme.test", "anything-at-all");
    expect(result).toEqual({ error: "Invalid email or password." });
    expect(created).toHaveLength(0);
  });

  it("says the same thing however the attempt failed", async () => {
    // A more specific message tells a stranger which addresses exist here and
    // which organizations federate.
    await person({ slug: "auth-a", email: "real@acme.test" });
    const wrong = await attempt("real@acme.test", "not-the-password");
    const missing = await attempt("nobody@acme.test", PASSWORD);
    expect(wrong).toEqual(missing);
  });
});
