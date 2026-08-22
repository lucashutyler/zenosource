// Turning a directory's user and group payloads into canonical fields.
//
// Everything below is defensive in one direction only: a shape we do not
// understand is an error, never a silently-ignored field. A directory that
// sends `active: false` in a shape this file skips would be told the
// deactivation succeeded, and an offboarded employee would keep their access
// with the directory's own console showing green. That is the single worst
// failure available in this file, so unparsed input fails loudly.

export type ParsedUser = {
  externalRef: string | null;
  email: string;
  name: string;
  active: boolean;
};

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; detail: string };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The primary work address, falling back to the first one present. */
export function readEmail(body: Record<string, unknown>): string {
  const emails = Array.isArray(body.emails) ? body.emails : [];
  const entries = emails.map(record).filter((e): e is Record<string, unknown> => e !== null);
  const primary = entries.find((e) => e.primary === true);
  const work = entries.find((e) => text(e.type).toLowerCase() === "work");
  const first = entries[0];
  const chosen = text(primary?.value) || text(work?.value) || text(first?.value);
  // userName is the fallback rather than the first choice: a directory may
  // carry a login name that is not an address, and an address is what this
  // product sends chase email to.
  return (chosen || text(body.userName)).toLowerCase();
}

export function readName(body: Record<string, unknown>): string {
  const name = record(body.name);
  const formatted = text(name?.formatted);
  if (formatted) return formatted;
  const given = text(name?.givenName);
  const family = text(name?.familyName);
  const joined = [given, family].filter(Boolean).join(" ");
  return joined || text(body.displayName) || text(body.userName);
}

export function parseUser(body: unknown): ParseOutcome<ParsedUser> {
  const payload = record(body);
  if (!payload) return { ok: false, detail: "The request body is not an object." };

  const email = readEmail(payload);
  if (!email || !email.includes("@")) {
    return { ok: false, detail: "The user has no email address." };
  }
  const name = readName(payload) || email;

  const activeRaw = payload.active;
  let active = true;
  if (typeof activeRaw === "boolean") {
    active = activeRaw;
  } else if (typeof activeRaw === "string") {
    // Some clients send the string. Accept the two spellings that mean
    // something and refuse anything else rather than guessing.
    const lowered = activeRaw.trim().toLowerCase();
    if (lowered === "true") active = true;
    else if (lowered === "false") active = false;
    else return { ok: false, detail: `Unrecognized value for active: ${activeRaw}` };
  } else if (activeRaw !== undefined && activeRaw !== null) {
    return { ok: false, detail: "Unrecognized value for active." };
  }

  return {
    ok: true,
    value: { externalRef: text(payload.externalId) || text(payload.id) || null, email, name, active },
  };
}

export type ParsedGroup = { externalRef: string | null; displayName: string; memberRefs: string[] };

export function parseGroup(body: unknown): ParseOutcome<ParsedGroup> {
  const payload = record(body);
  if (!payload) return { ok: false, detail: "The request body is not an object." };
  const displayName = text(payload.displayName);
  if (!displayName) return { ok: false, detail: "The group has no display name." };
  const members = Array.isArray(payload.members) ? payload.members : [];
  const memberRefs: string[] = [];
  for (const member of members) {
    const entry = record(member);
    const value = text(entry?.value);
    if (!value) return { ok: false, detail: "A group member has no identifier." };
    memberRefs.push(value);
  }
  return {
    ok: true,
    value: {
      externalRef: text(payload.externalId) || text(payload.id) || null,
      displayName,
      memberRefs,
    },
  };
}
