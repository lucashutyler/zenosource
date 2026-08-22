// Filter parsing, deliberately tiny.
//
// A directory sends exactly two shapes — `userName eq "someone@acme.test"`
// and `externalId eq "00u..."` — plus `displayName eq "..."` for groups.
// Implementing the rest of the filter grammar would be a parser to get wrong
// for nobody's benefit, and a filter we half-understand is worse than one we
// refuse: silently ignoring a clause returns every user in the tenant to a
// query that asked for one.

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
