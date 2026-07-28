import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory stand-in for Next's cookie store so session.ts's real
// createSession/readSession/deleteSession run unmodified against it.
const store = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (store.has(name) ? { value: store.get(name) } : undefined),
    set: (name: string, value: string) => {
      store.set(name, value);
    },
    delete: (name: string) => {
      store.delete(name);
    },
  }),
}));

beforeEach(() => {
  store.clear();
  process.env.SESSION_SECRET = "test-secret-value-not-for-production-use";
});

describe("session", () => {
  it("round-trips a created session", async () => {
    const { createSession, readSession } = await import("./session");
    await createSession({ internalUserId: "user-1", tenantId: "tenant-1" });
    const session = await readSession();
    expect(session).toMatchObject({ internalUserId: "user-1", tenantId: "tenant-1" });
  });

  it("returns null when no session cookie is set", async () => {
    const { readSession } = await import("./session");
    expect(await readSession()).toBeNull();
  });

  it("returns null for a tampered token", async () => {
    const { createSession, readSession } = await import("./session");
    await createSession({ internalUserId: "user-1", tenantId: "tenant-1" });
    store.set("session", store.get("session") + "tampered");
    expect(await readSession()).toBeNull();
  });

  it("clears the session on deleteSession", async () => {
    const { createSession, readSession, deleteSession } = await import("./session");
    await createSession({ internalUserId: "user-1", tenantId: "tenant-1" });
    await deleteSession();
    expect(await readSession()).toBeNull();
  });
});
