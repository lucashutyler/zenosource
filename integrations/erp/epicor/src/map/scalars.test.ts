import { describe, it, expect } from "vitest";
import { dateOnly, decimalString, bool, field, int, text } from "./scalars";

describe("dateOnly", () => {
  // The bug this exists to prevent has already shipped once, at thirteen call
  // sites: "every user-entered date renders one day early" (Phase 1b Wave 1).
  // An ERP feed is a fourteenth way in, and the only defence is never
  // constructing a Date from an Epicor string.
  it("takes the date textually, ignoring the offset", () => {
    expect(dateOnly("2026-08-14T00:00:00-07:00")).toBe("2026-08-14");
    expect(dateOnly("2026-08-14T00:00:00Z")).toBe("2026-08-14");
    expect(dateOnly("2026-08-14T23:59:59+13:00")).toBe("2026-08-14");
  });

  it("does not shift a date across a day boundary for any offset", () => {
    // The failing version of this function — new Date(x).toISOString() — turns
    // the first of these into 2026-08-14 and the second into 2026-08-15.
    expect(dateOnly("2026-08-14T00:00:00-07:00")).toBe("2026-08-14");
    expect(dateOnly("2026-08-14T22:00:00-07:00")).toBe("2026-08-14");
  });

  it("returns undefined rather than guessing", () => {
    expect(dateOnly("")).toBeUndefined();
    expect(dateOnly(null)).toBeUndefined();
    expect(dateOnly("not a date")).toBeUndefined();
  });
});

describe("decimalString", () => {
  it("never emits exponential notation — Postgres numeric can't parse it", () => {
    expect(decimalString(0.0000001)).not.toMatch(/e/i);
    expect(decimalString(1234567890.12)).not.toMatch(/e/i);
  });

  it("matches the column's scale", () => {
    expect(decimalString(8.755)).toBe("8.7550");
    expect(decimalString(1)).toBe("1.0000");
  });

  it("refuses values that can't fit Decimal(14,4) instead of truncating them", () => {
    // The seeded $12-trillion purchase order in docs/todo.md surfaced as a
    // numeric overflow the first time a migration tried to SUM order values.
    // An ERP is fully capable of sending one; it gets skipped with a reason,
    // not silently rounded into something plausible.
    expect(decimalString(1e14)).toBeUndefined();
    expect(decimalString(1e20)).toBeUndefined();
    expect(decimalString(Infinity)).toBeUndefined();
    expect(decimalString(NaN)).toBeUndefined();
  });

  it("passes through well-formed strings untouched, preserving precision", () => {
    expect(decimalString("8.7550")).toBe("8.7550");
    expect(decimalString("  12.5 ")).toBe("12.5");
    expect(decimalString("1e5")).toBeUndefined();
  });

  it("distinguishes absent from zero", () => {
    expect(decimalString(0)).toBe("0.0000");
    expect(decimalString(null)).toBeUndefined();
    expect(decimalString("")).toBeUndefined();
  });
});

describe("field", () => {
  it("takes the first present candidate, so a version difference is one array entry", () => {
    expect(field({ DocUnitCost: 5 }, "UnitCost", "DocUnitCost")).toBe(5);
    expect(field({ UnitCost: 3, DocUnitCost: 5 }, "UnitCost", "DocUnitCost")).toBe(3);
  });

  it("treats null as absent but keeps zero and empty string", () => {
    expect(field({ a: null, b: 0 }, "a", "b")).toBe(0);
    expect(field({ a: "" }, "a")).toBe("");
    expect(field({}, "a")).toBeUndefined();
  });
});

describe("bool / int / text", () => {
  it("accepts the three shapes Epicor actually sends", () => {
    expect(bool(true)).toBe(true);
    expect(bool("false")).toBe(false);
    expect(bool(1)).toBe(true);
    expect(bool("nonsense")).toBeUndefined();
  });

  it("trims text and treats blank as absent", () => {
    expect(text("  ACME  ")).toBe("ACME");
    expect(text("   ")).toBeUndefined();
  });

  it("parses ints without accepting decimals as strings", () => {
    expect(int("42")).toBe(42);
    expect(int(42.7)).toBe(42);
    expect(int("42.7")).toBeUndefined();
  });
});
