import type { DateOnlyString, DecimalString } from "../types";

// Field access and scalar conversion for BO rows.
//
// Two hazards live in this file, and both have already bitten this codebase
// once in a different form.

/**
 * Read the first candidate column that is present.
 *
 * Kinetic column spellings differ across versions and customizations — the
 * same value is `UnitCost` on one instance and `DocUnitCost` on another, and a
 * customized site may add a UD column that supersedes both. Threading a
 * candidate list through here means a version difference is one entry in an
 * array, not a fork of the mapper. Returns undefined when none matched, so
 * callers can tell "absent" from "present and zero" — which matters, because
 * a missing quantity must not map to 0.
 */
export function field<T = unknown>(row: Record<string, unknown>, ...names: string[]): T | undefined {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null) return value as T;
  }
  return undefined;
}

/**
 * Decimals cross the boundary as strings, and are produced without ever
 * touching a float where it can be avoided.
 *
 * JSON.parse has already turned an Epicor number into a JS double by the time
 * this sees it, so the remaining job is to serialize it back without
 * exponential notation — `1e-7` and `1.2e+21` are both valid JS number
 * strings and neither parses as a Postgres numeric. The platform's column is
 * Decimal(14,4); anything that can't be represented is rejected upstream
 * rather than silently truncated, which is the lesson from the seeded
 * $12-trillion purchase order in docs/todo.md.
 */
export function decimalString(value: unknown): DecimalString | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^-?\d+(\.\d+)?$/.test(trimmed) ? trimmed : undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  // toFixed(4) matches Decimal(14,4) exactly and never emits an exponent.
  // Values beyond 1e14 are out of range for the column and are surfaced as
  // undefined so the caller skips the record with a reason.
  if (Math.abs(value) >= 1e14) return undefined;
  return value.toFixed(4);
}

/**
 * `2026-08-14`, taken textually.
 *
 * Never `new Date(...)` then `toISOString()`. Epicor sends
 * `2026-08-14T00:00:00-07:00`; parsing that and re-serializing in UTC yields
 * 2026-08-14T07:00:00Z, and rendering *that* in a server timezone west of UTC
 * puts it back on the 13th. That is exactly the bug Phase 1b Wave 1 fixed at
 * thirteen call sites — "every user-entered date renders one day early" — and
 * an ERP feed is a fourteenth way in. The date part of an Epicor date field
 * is already the date the buyer means; the time and offset are noise.
 */
export function dateOnly(value: unknown): DateOnlyString | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : undefined;
}

/** Epicor booleans arrive as true/false, "true"/"false", or 0/1. */
export function bool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true" || lower === "1") return true;
    if (lower === "false" || lower === "0") return false;
  }
  return undefined;
}

export function text(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number") return String(value);
  return undefined;
}

export function int(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return parseInt(value, 10);
  return undefined;
}
