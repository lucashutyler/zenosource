import { describe, it, expect } from "vitest";
import {
  ageStep,
  daysBetween,
  formatDate,
  formatDueIn,
  formatDwell,
  formatMoney,
  formatMoneyCompact,
  formatQuantity,
  formatUnitPrice,
  parseDateInput,
  toDateInputValue,
} from "./format";

// The timezone bug this file exists to close was reproduced at thirteen
// separate call sites: `new Date("2026-08-18")` is UTC midnight, and
// `.toLocaleDateString()` with no `timeZone` renders it in the *server's*
// zone — so a need-by typed as 18 August displayed as 17 August to everyone
// west of UTC, on every screen, including the one the supplier sees.
//
// These tests pin the behaviour rather than the implementation: they'd fail
// on a machine running in any negative-offset timezone if the formatter ever
// stopped forcing UTC.

describe("dates", () => {
  it("renders a stored calendar date on the day it was typed", () => {
    const stored = parseDateInput("2026-08-18")!;
    expect(formatDate(stored)).toBe("18 Aug 2026");
  });

  it("round-trips a date input value without drifting a day", () => {
    const stored = parseDateInput("2026-01-01")!;
    expect(toDateInputValue(stored)).toBe("2026-01-01");
    expect(formatDate(stored)).toBe("01 Jan 2026");
  });

  it("uses one unambiguous format, not a locale-dependent one", () => {
    // `7/28/2026` and `28/7/2026` are the same string to a machine and
    // opposite dates to two readers — and this document gets forwarded to
    // suppliers we don't control the locale of.
    expect(formatDate(parseDateInput("2026-07-28"))).toBe("28 Jul 2026");
  });

  it("rejects anything that isn't a bare calendar date", () => {
    expect(parseDateInput("2026-08-18T12:00:00-04:00")).toBeNull();
    expect(parseDateInput("18/08/2026")).toBeNull();
    expect(parseDateInput("")).toBeNull();
    expect(parseDateInput(null)).toBeNull();
  });

  it("rejects a date that doesn't exist rather than rolling it forward", () => {
    // `new Date("2026-02-30")` silently becomes 2 March.
    expect(parseDateInput("2026-02-30")).toBeNull();
    expect(parseDateInput("2026-13-01")).toBeNull();
  });

  it("renders missing dates as an em dash, never as today", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });
});

describe("dwell", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  it("counts whole days", () => {
    expect(daysBetween(new Date("2026-07-26T12:00:00Z"), now)).toBe(3);
  });

  it("says today rather than 0d", () => {
    expect(formatDwell(new Date("2026-07-29T09:00:00Z"), now)).toBe("today");
  });

  it("switches to weeks once days stop carrying meaning", () => {
    expect(formatDwell(new Date("2026-07-18T12:00:00Z"), now)).toBe("11d");
    expect(formatDwell(new Date("2026-06-01T12:00:00Z"), now)).toBe("8w");
  });

  it("steps the oxidation ramp on a working week, not a smooth gradient", () => {
    // Same day and next day are indistinguishable to a buyer; "still open
    // after a week" and "still open after a fortnight" are different problems.
    expect(ageStep(0)).toBe(0);
    expect(ageStep(1)).toBe(0);
    expect(ageStep(3)).toBe(1);
    expect(ageStep(7)).toBe(2);
    expect(ageStep(14)).toBe(3);
    expect(ageStep(15)).toBe(4);
    expect(ageStep(90)).toBe(4);
  });
});

describe("money and quantities", () => {
  it("renders totals to two decimals and unit prices to four", () => {
    // A negotiated price of $8.755 rounded to $8.76 misrepresents a schedule.
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatUnitPrice(8.755)).toBe("$8.755");
  });

  it("compacts aggregates for the sentence a CFO reads", () => {
    expect(formatMoneyCompact(1_400_000)).toBe("$1.4M");
    expect(formatMoneyCompact(310_000)).toBe("$310K");
    expect(formatMoneyCompact(940)).toBe("$940.00");
  });

  it("strips the trailing zeros a Decimal(14,4) carries", () => {
    expect(formatQuantity("500.0000")).toBe("500");
    expect(formatQuantity("12.5000")).toBe("12.5");
  });

  it("renders a missing amount as an em dash, never as zero", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatQuantity(undefined)).toBe("—");
  });
});

describe("formatDueIn", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");

  it("distinguishes a deadline behind you from one ahead", () => {
    // The distinction dwell can't make. "12d" for both "needed twelve days
    // ago" and "needed in twelve days" collapses the only fact that decides
    // whether to act today.
    expect(formatDueIn(new Date("2026-08-07T12:00:00.000Z"), now)).toBe("12d ago");
    expect(formatDueIn(new Date("2026-08-31T12:00:00.000Z"), now)).toBe("in 12d");
  });

  it("says today for anything inside a day, in either direction", () => {
    expect(formatDueIn(now, now)).toBe("today");
    expect(formatDueIn(new Date("2026-08-19T20:00:00.000Z"), now)).toBe("today");
    expect(formatDueIn(new Date("2026-08-19T04:00:00.000Z"), now)).toBe("today");
  });

  it("switches to weeks past 28 days, the same as dwell", () => {
    expect(formatDueIn(new Date("2026-10-19T12:00:00.000Z"), now)).toBe("in 8w");
    expect(formatDueIn(new Date("2026-06-19T12:00:00.000Z"), now)).toBe("8w ago");
  });
});
