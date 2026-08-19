import type { FetchLike } from "../client";

// A scripted Kinetic, so every test in this package runs without an ERP.
//
// There is no Kinetic instance in CI and there will not be one before a pilot
// customer exists (docs/todo.md Phase 5). A connector whose tests need a live
// ERP is a connector with no tests, so the transport is injected and this is
// what gets injected.

export type Route = {
  /** Matched against the request URL with `includes`. */
  match: string;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** When set, only matches requests that do (or don't) carry an identity. */
  requiresIdentity?: boolean;
};

export type FakeKinetic = {
  fetchImpl: FetchLike;
  /** Every request made, in order — for asserting paging and chunking. */
  calls: { url: string; method: string; body?: string; hadIdentity: boolean }[];
};

export function fakeKinetic(routes: Route[]): FakeKinetic {
  const calls: FakeKinetic["calls"] = [];

  const fetchImpl: FetchLike = async (url, init) => {
    const hadIdentity = Boolean(init.headers.Authorization);
    calls.push({ url, method: init.method, body: init.body, hadIdentity });

    const route = routes.find(
      (r) =>
        url.includes(r.match) &&
        (r.requiresIdentity === undefined || r.requiresIdentity === hadIdentity)
    );

    if (!route) {
      return response(404, { error: { message: "no route" } });
    }
    return response(route.status ?? 200, route.body ?? { value: [] }, route.headers);
  };

  return { fetchImpl, calls };
}

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    async text() {
      return text;
    },
  };
}

export const TEST_CONFIG = {
  baseUrl: "https://kinetic.example.com/Prod",
  company: "EPIC06",
  authMode: "basic" as const,
};

export const TEST_SECRETS = {
  apiKey: "test-api-key",
  username: "svc-zenosource",
  password: "hunter2",
};

export const TEST_SESSION = {
  config: TEST_CONFIG as unknown as Record<string, unknown>,
  secrets: TEST_SECRETS as unknown as Record<string, string>,
};
