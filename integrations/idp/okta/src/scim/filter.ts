// An unsupported filter is refused, never ignored: silently dropping a clause
// would answer a query that asked for one user with the whole tenant.

export type ParsedFilter =
  | { ok: true; attribute: string; value: string }
  | { ok: false; detail: string }
  | { ok: true; attribute: null; value: null };

const SUPPORTED = new Set(["username", "externalid", "displayname", "id"]);

export function parseFilter(raw: string | undefined): ParsedFilter {
  if (!raw || !raw.trim()) return { ok: true, attribute: null, value: null };

  const match = /^\s*([A-Za-z][\w.]*)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/.exec(raw);
  if (!match) {
    return {
      ok: false,
      detail: `Only equality filters are supported, e.g. userName eq "someone@example.com".`,
    };
  }
  const attribute = match[1];
  if (!SUPPORTED.has(attribute.toLowerCase())) {
    return { ok: false, detail: `Filtering on ${attribute} is not supported.` };
  }
  const value = match[2].replace(/\\(.)/g, "$1");
  return { ok: true, attribute: attribute.toLowerCase(), value };
}

export function parsePaging(query: Record<string, string>): {
  startIndex: number;
  count: number;
} {
  const startIndex = Number.parseInt(query.startIndex ?? "1", 10);
  const count = Number.parseInt(query.count ?? "100", 10);
  return {
    startIndex: Number.isFinite(startIndex) && startIndex >= 1 ? startIndex : 1,
    count: Number.isFinite(count) && count >= 0 ? Math.min(count, 200) : 100,
  };
}
