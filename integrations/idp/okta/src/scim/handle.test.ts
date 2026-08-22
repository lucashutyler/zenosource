import { describe, it, expect } from "vitest";
import { handleDirectoryRequest } from "./handle";
import { createMemoryStore } from "../testing/memory-store";
import type { DirectoryRequest, DirectoryUser } from "../types";

// The directory protocol, translated.
//
// The point of most of these is one sentence: a deactivation must never be
// answered with a 200 unless it happened. A directory records a 200 as done
// and stops retrying, so a shape we failed to understand and quietly ignored
// leaves someone who has left with their access, and the directory's own
// console showing green.

const SEED: DirectoryUser[] = [
  { externalRef: "00uCASEY", email: "casey@acme.test", name: "Casey Buyer", active: true },
];

function request(overrides: Partial<DirectoryRequest>): DirectoryRequest {
  return { method: "GET", segments: [], query: {}, body: null, ...overrides };
}

describe("users", () => {
  it("lists with 1-based paging echoed back", async () => {
    const store = createMemoryStore(SEED);
    const response = await handleDirectoryRequest(
      request({ segments: ["Users"], query: { startIndex: "1", count: "10" } }),
      store
    );
    expect(response.status).toBe(200);
    const body = response.body as { totalResults: number; startIndex: number; Resources: unknown[] };
    expect(body.totalResults).toBe(1);
    expect(body.startIndex).toBe(1);
    expect(body.Resources).toHaveLength(1);
  });

  it("answers the one filter a directory actually sends", async () => {
    const store = createMemoryStore(SEED);
    const response = await handleDirectoryRequest(
      request({ segments: ["Users"], query: { filter: 'userName eq "casey@acme.test"' } }),
      store
    );
    const body = response.body as { totalResults: number };
    expect(body.totalResults).toBe(1);
  });

  it("refuses a filter it cannot fully understand rather than returning everyone", async () => {
    const store = createMemoryStore(SEED);
    const response = await handleDirectoryRequest(
      request({ segments: ["Users"], query: { filter: 'userName sw "ca"' } }),
      store
    );
    // Silently ignoring the clause would answer "who is casey?" with the
    // whole tenant.
    expect(response.status).toBe(400);
  });

  it("adopts an address that already exists rather than stalling the import", async () => {
    const store = createMemoryStore(SEED);
    const response = await handleDirectoryRequest(
      request({
        method: "POST",
        segments: ["Users"],
        body: {
          externalId: "00uNEWCASEY",
          userName: "casey@acme.test",
          name: { givenName: "Casey", familyName: "Buyer" },
          active: true,
        },
      }),
      store
    );
    expect(response.status).toBe(201);
    expect(store.users.has("00uNEWCASEY")).toBe(true);
  });

  it("creates a user deactivated when the directory says so", async () => {
    const store = createMemoryStore();
    const response = await handleDirectoryRequest(
      request({
        method: "POST",
        segments: ["Users"],
        body: { externalId: "00uNEW", userName: "new@acme.test", active: false },
      }),
      store
    );
    expect(response.status).toBe(201);
    expect((response.body as { active: boolean }).active).toBe(false);
  });

  describe("deactivation", () => {
    // Every shape below is one a real directory sends, and all of them mean
    // the same thing.
    const shapes: { name: string; body: unknown }[] = [
      { name: "a pathless replace carrying an object", body: { Operations: [{ op: "replace", value: { active: false } }] } },
      { name: "a replace with an explicit path", body: { Operations: [{ op: "replace", path: "active", value: false }] } },
      { name: "mixed case and a stringified boolean", body: { Operations: [{ op: "Replace", path: "active", value: "False" }] } },
      { name: "lowercase operations key", body: { operations: [{ op: "replace", path: "active", value: false }] } },
    ];

    for (const shape of shapes) {
      it(`applies ${shape.name}`, async () => {
        const store = createMemoryStore(SEED);
        const response = await handleDirectoryRequest(
          request({ method: "PATCH", segments: ["Users", "00uCASEY"], body: shape.body }),
          store
        );
        expect(response.status).toBe(200);
        expect((response.body as { active: boolean }).active).toBe(false);
        expect(store.users.get("00uCASEY")!.active).toBe(false);
      });
    }

    it("answers 400, never 200, for a shape it cannot read", async () => {
      const store = createMemoryStore(SEED);
      const response = await handleDirectoryRequest(
        request({
          method: "PATCH",
          segments: ["Users", "00uCASEY"],
          body: { Operations: [{ op: "replace", path: "active", value: "perhaps" }] },
        }),
        store
      );
      expect(response.status).toBe(400);
      expect(store.users.get("00uCASEY")!.active).toBe(true);
    });

    it("treats a delete as a deactivation and never removes the row", async () => {
      const store = createMemoryStore(SEED);
      const response = await handleDirectoryRequest(
        request({ method: "DELETE", segments: ["Users", "00uCASEY"] }),
        store
      );
      expect(response.status).toBe(204);
      // Every order this person issued and every item they resolved points at
      // this row.
      expect(store.users.has("00uCASEY")).toBe(true);
      expect(store.users.get("00uCASEY")!.active).toBe(false);
    });

    it("reactivates, because a directory can undo an offboarding", async () => {
      const store = createMemoryStore([{ ...SEED[0], active: false }]);
      const response = await handleDirectoryRequest(
        request({
          method: "PATCH",
          segments: ["Users", "00uCASEY"],
          body: { Operations: [{ op: "replace", value: { active: true } }] },
        }),
        store
      );
      expect(response.status).toBe(200);
      expect(store.users.get("00uCASEY")!.active).toBe(true);
    });

    it("passes a refusal through as a conflict with the reason", async () => {
      const store = createMemoryStore(SEED, { undeactivatable: ["casey@acme.test"] });
      const response = await handleDirectoryRequest(
        request({
          method: "PATCH",
          segments: ["Users", "00uCASEY"],
          body: { Operations: [{ op: "replace", value: { active: false } }] },
        }),
        store
      );
      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body)).toMatch(/last owner/i);
      expect(store.users.get("00uCASEY")!.active).toBe(true);
    });
  });

  it("refuses an address that belongs to somebody else", async () => {
    const store = createMemoryStore([
      ...SEED,
      { externalRef: "00uJORDAN", email: "buyer@acme.test", name: "Jordan Buyer", active: true },
    ]);
    const response = await handleDirectoryRequest(
      request({
        method: "PATCH",
        segments: ["Users", "00uCASEY"],
        body: { Operations: [{ op: "replace", path: "userName", value: "buyer@acme.test" }] },
      }),
      store
    );
    expect(response.status).toBe(409);
    expect(store.users.get("00uCASEY")!.email).toBe("casey@acme.test");
  });

  it("answers 404 for a user it has never seen", async () => {
    const store = createMemoryStore(SEED);
    const response = await handleDirectoryRequest(
      request({ segments: ["Users", "00uNOBODY"] }),
      store
    );
    expect(response.status).toBe(404);
  });
});

describe("groups", () => {
  it("creates a group with its members", async () => {
    const store = createMemoryStore(SEED);
    const response = await handleDirectoryRequest(
      request({
        method: "POST",
        segments: ["Groups"],
        body: {
          externalId: "00gPROC",
          displayName: "Procurement",
          members: [{ value: "00uCASEY" }],
        },
      }),
      store
    );
    expect(response.status).toBe(201);
    expect(await store.listGroupMembers("00gPROC")).toHaveLength(1);
  });

  it("adds and removes members in both shapes a directory sends", async () => {
    const store = createMemoryStore(SEED);
    await store.upsertGroup({ externalRef: "00gPROC", displayName: "Procurement" });

    await handleDirectoryRequest(
      request({
        method: "PATCH",
        segments: ["Groups", "00gPROC"],
        body: { Operations: [{ op: "add", path: "members", value: [{ value: "00uCASEY" }] }] },
      }),
      store
    );
    expect(await store.listGroupMembers("00gPROC")).toHaveLength(1);

    await handleDirectoryRequest(
      request({
        method: "PATCH",
        segments: ["Groups", "00gPROC"],
        body: { Operations: [{ op: "remove", path: 'members[value eq "00uCASEY"]' }] },
      }),
      store
    );
    expect(await store.listGroupMembers("00gPROC")).toHaveLength(0);
  });

  it("refuses a removal that names nobody rather than emptying the group", async () => {
    const store = createMemoryStore(SEED);
    await store.upsertGroup({ externalRef: "00gPROC", displayName: "Procurement" });
    await store.setGroupMembers("00gPROC", ["00uCASEY"]);

    const response = await handleDirectoryRequest(
      request({
        method: "PATCH",
        segments: ["Groups", "00gPROC"],
        body: { Operations: [{ op: "remove", path: "members" }] },
      }),
      store
    );
    expect(response.status).toBe(400);
    expect(await store.listGroupMembers("00gPROC")).toHaveLength(1);
  });
});

describe("what this service says it supports", () => {
  it("says bulk is unsupported, so nothing tries it mid-import", async () => {
    const store = createMemoryStore();
    const response = await handleDirectoryRequest(
      request({ segments: ["ServiceProviderConfig"] }),
      store
    );
    expect(response.status).toBe(200);
    expect((response.body as { bulk: { supported: boolean } }).bulk.supported).toBe(false);
    expect((response.body as { patch: { supported: boolean } }).patch.supported).toBe(true);
  });

  it("answers 404 for a resource it does not serve", async () => {
    const store = createMemoryStore();
    expect((await handleDirectoryRequest(request({ segments: ["Bulk"] }), store)).status).toBe(404);
    expect((await handleDirectoryRequest(request({ segments: ["Me"] }), store)).status).toBe(404);
  });
});
