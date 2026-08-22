import type { ParseOutcome } from "./parse";

// PATCH, which is where a directory says "this person has left".
//
// The shapes below are all in use in the wild, from the same vendor:
//
//   { op: "replace", value: { active: false } }
//   { op: "replace", path: "active", value: false }
//   { op: "Replace", path: "active", value: "False" }
//   { op: "add",     path: "members", value: [{ value: "00u..." }] }
//   { op: "remove",  path: "members[value eq \"00u...\"]" }
//
// Anything not matched here is a 400. Not a 200-with-no-effect: the directory
// records a 200 as success and stops retrying, and the deactivation that
// silently did nothing is the failure this whole file exists to prevent.

export const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

export type UserPatch = {
  active?: boolean;
  email?: string;
  name?: string;
};

export type GroupPatch = {
  displayName?: string;
  add: string[];
  remove: string[];
  /** Present when the directory replaced the whole membership at once. */
  replace?: string[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown): boolean | { error: string } {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return { error: `Unrecognized value for active: ${JSON.stringify(value)}` };
}

function operations(body: unknown): ParseOutcome<Record<string, unknown>[]> {
  const payload = record(body);
  if (!payload) return { ok: false, detail: "The request body is not an object." };
  const raw = payload.Operations ?? payload.operations;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, detail: "The patch carries no operations." };
  }
  const parsed: Record<string, unknown>[] = [];
  for (const entry of raw) {
    const operation = record(entry);
    if (!operation) return { ok: false, detail: "An operation is not an object." };
    parsed.push(operation);
  }
  return { ok: true, value: parsed };
}

/** `members[value eq "00u123"]` → `00u123`. */
function memberFromPath(path: string): string | null {
  const match = /^members\[\s*value\s+eq\s+"((?:[^"\\]|\\.)*)"\s*\]$/i.exec(path.trim());
  return match ? match[1].replace(/\\(.)/g, "$1") : null;
}

function memberValues(value: unknown): string[] | null {
  const list = Array.isArray(value) ? value : [value];
  const refs: string[] = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      refs.push(entry);
      continue;
    }
    const object = record(entry);
    const ref = text(object?.value);
    if (!ref) return null;
    refs.push(ref);
  }
  return refs;
}

export function parseUserPatch(body: unknown): ParseOutcome<UserPatch> {
  const parsed = operations(body);
  if (!parsed.ok) return parsed;

  const patch: UserPatch = {};
  for (const operation of parsed.value) {
    const op = text(operation.op).toLowerCase();
    if (op !== "replace" && op !== "add") {
      return { ok: false, detail: `Unsupported operation on a user: ${op || "(none)"}.` };
    }
    const path = text(operation.path);

    if (!path) {
      // The pathless form carries a whole object of attributes to merge.
      const value = record(operation.value);
      if (!value) return { ok: false, detail: "A patch operation has no path and no object value." };
      for (const [key, raw] of Object.entries(value)) {
        const lowered = key.toLowerCase();
        if (lowered === "active") {
          const active = readBoolean(raw);
          if (typeof active !== "boolean") return { ok: false, detail: active.error };
          patch.active = active;
        } else if (lowered === "username") {
          patch.email = text(raw).toLowerCase();
        } else if (lowered === "displayname") {
          patch.name = text(raw);
        } else if (lowered === "name") {
          const name = record(raw);
          const formatted =
            text(name?.formatted) ||
            [text(name?.givenName), text(name?.familyName)].filter(Boolean).join(" ");
          if (formatted) patch.name = formatted;
        }
        // Anything else is a directory attribute this product does not model.
        // Ignoring it is correct — unlike `active`, no other attribute here
        // can silently fail to revoke access.
      }
      continue;
    }

    const lowered = path.toLowerCase();
    if (lowered === "active") {
      const active = readBoolean(operation.value);
      if (typeof active !== "boolean") return { ok: false, detail: active.error };
      patch.active = active;
    } else if (lowered === "username" || lowered.startsWith("emails")) {
      const value =
        typeof operation.value === "string"
          ? operation.value
          : text(memberValues(operation.value)?.[0]);
      const email = text(value).toLowerCase();
      if (email) patch.email = email;
    } else if (lowered === "displayname" || lowered.startsWith("name")) {
      const value = typeof operation.value === "string" ? operation.value : "";
      if (value) patch.name = text(value);
      else {
        const name = record(operation.value);
        const formatted =
          text(name?.formatted) ||
          [text(name?.givenName), text(name?.familyName)].filter(Boolean).join(" ");
        if (formatted) patch.name = formatted;
      }
    }
    // Other paths are attributes this product does not carry.
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, detail: "The patch changes nothing this directory service understands." };
  }
  return { ok: true, value: patch };
}

export function parseGroupPatch(body: unknown): ParseOutcome<GroupPatch> {
  const parsed = operations(body);
  if (!parsed.ok) return parsed;

  const patch: GroupPatch = { add: [], remove: [] };
  for (const operation of parsed.value) {
    const op = text(operation.op).toLowerCase();
    const path = text(operation.path);
    const scoped = memberFromPath(path);

    if (op === "remove") {
      if (scoped) {
        patch.remove.push(scoped);
        continue;
      }
      if (path.toLowerCase() === "members") {
        const refs = memberValues(operation.value);
        if (refs === null) {
          // A bare `remove members` with no value means "empty the group",
          // which is a membership change we must not guess at.
          return { ok: false, detail: "A member removal carries no identifier." };
        }
        patch.remove.push(...refs);
        continue;
      }
      return { ok: false, detail: `Unsupported removal from a group: ${path || "(no path)"}.` };
    }

    if (op !== "add" && op !== "replace") {
      return { ok: false, detail: `Unsupported operation on a group: ${op || "(none)"}.` };
    }

    if (path.toLowerCase() === "members") {
      const refs = memberValues(operation.value);
      if (refs === null) return { ok: false, detail: "A member operation carries no identifier." };
      if (op === "replace") patch.replace = refs;
      else patch.add.push(...refs);
      continue;
    }

    if (path.toLowerCase() === "displayname") {
      const value = text(operation.value);
      if (value) patch.displayName = value;
      continue;
    }

    if (!path) {
      const value = record(operation.value);
      if (!value) return { ok: false, detail: "A patch operation has no path and no object value." };
      const displayName = text(value.displayName);
      if (displayName) patch.displayName = displayName;
      if (value.members !== undefined) {
        const refs = memberValues(value.members);
        if (refs === null) return { ok: false, detail: "A member operation carries no identifier." };
        if (op === "replace") patch.replace = refs;
        else patch.add.push(...refs);
      }
      continue;
    }

    return { ok: false, detail: `Unsupported operation on a group: ${path}.` };
  }

  if (
    patch.displayName === undefined &&
    patch.add.length === 0 &&
    patch.remove.length === 0 &&
    patch.replace === undefined
  ) {
    return { ok: false, detail: "The patch changes nothing this directory service understands." };
  }
  return { ok: true, value: patch };
}
