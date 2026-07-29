// The single formatting authority. Every date, money amount, quantity and
// dwell in the product renders through here.
//
// This file exists because the Phase 1a audit found three money formats, two
// date formats, and a timezone bug reproduced at thirteen separate call
// sites — each one an independent `toLocaleDateString()` with no `timeZone`,
// so a need-by typed as 18 Aug displayed as 17 Aug to anyone west of UTC.
// Formatting spread across call sites doesn't stay consistent; it only ever
// diverges. Nothing outside this module should call `toLocaleDateString`,
// `toLocaleString` or `Intl.*` directly — there's a lint-visible grep for it.

// --- Dates -----------------------------------------------------------------
//
// Dates in this product are *calendar* dates, not instants: a need-by of
// 18 Aug means the 18th at the buyer's plant, not 00:00 UTC. They're stored
// as UTC midnight and must therefore be read back in UTC, or the day flips
// for every user in a negative-offset timezone. One format, everywhere:
// `28 Jul 2026`. Unambiguous between US and European readers (which
// `7/28/2026` is not — and this document gets forwarded to suppliers), and
// fixed-width in the day and year fields so it aligns in a ledger column.

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DATE_SHORT_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** `28 Jul 2026`. Null-safe: returns an em dash for missing dates. */
export function formatDate(value: Date | string | null | undefined): string {
  if (value == null) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return DATE_FMT.format(d).replace(/,/g, "");
}

/** `28 Jul` — for columns where the year is implied by context. */
export function formatDateShort(value: Date | string | null | undefined): string {
  if (value == null) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return DATE_SHORT_FMT.format(d).replace(/,/g, "");
}

/** `28 Jul 2026 14:32` — for audit trails, where the time is the point. */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (value == null) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return DATETIME_FMT.format(d).replace(/,/g, "");
}

/**
 * The `value` for an `<input type="date">`, in UTC — `2026-08-18`.
 * `toISOString().slice(0,10)` happens to be the same thing, but only because
 * the date was stored at UTC midnight; going through here makes that
 * assumption explicit and keeps it in one place.
 */
export function toDateInputValue(value: Date | string | null | undefined): string {
  if (value == null) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Parse a `YYYY-MM-DD` from a date input into the UTC midnight we store.
 *
 * `new Date("2026-08-18")` already yields UTC midnight, so this looks like a
 * no-op — it isn't. It rejects anything that isn't a bare calendar date
 * (`2026-08-18T12:00:00-04:00` would silently land on the 17th in UTC), and
 * it makes the storage convention greppable instead of implicit.
 */
export function parseDateInput(value: FormDataEntryValue | null | undefined): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip check: rejects 2026-02-30, which Date would roll to 2 Mar.
  if (d.toISOString().slice(0, 10) !== trimmed) return null;
  return d;
}

/** Today at UTC midnight — the reference point for every dwell calculation. */
export function todayUTC(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Whole days between two instants, positive when `to` is later. */
export function daysBetween(from: Date, to: Date = new Date()): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

// --- Dwell -----------------------------------------------------------------
//
// How long something has been waiting, and how hard that should look. The
// product's whole competitive claim is that it draws the clock: SourceDay's
// urgency is a sticker someone has to remember to apply, and Axya renders
// one-day-late and forty-days-late identically.

/**
 * `today` / `3d` / `11d` / `6w`. Weeks past 28 days, because `47d` stops
 * carrying meaning as a number and starts being a wall.
 */
export function formatDwell(since: Date | string, now: Date = new Date()): string {
  const from = typeof since === "string" ? new Date(since) : since;
  const days = daysBetween(from, now);
  if (days <= 0) return "today";
  if (days < 28) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/**
 * Where a dwell sits on the five-step oxidation ramp — 0 (fresh steel) to
 * 4 (oxblood). Hue is redundantly encoded as stroke weight in the CSS, so
 * the ramp survives greyscale, colour-blindness and print.
 *
 * The steps are calibrated to a working week, not a smooth gradient: same
 * day and next day are indistinguishable to a buyer, but "still open after a
 * full week" and "still open after a fortnight" are different problems.
 */
export function ageStep(days: number): 0 | 1 | 2 | 3 | 4 {
  if (days <= 1) return 0;
  if (days <= 3) return 1;
  if (days <= 7) return 2;
  if (days <= 14) return 3;
  return 4;
}

export function ageStepSince(since: Date | string, now: Date = new Date()): 0 | 1 | 2 | 3 | 4 {
  const from = typeof since === "string" ? new Date(since) : since;
  return ageStep(daysBetween(from, now));
}

// --- Money -----------------------------------------------------------------
//
// USD only for v1 (docs/todo.md Phase 1b, decision 2). `PriceBreak.currency`
// exists and defaults to USD, but nothing exposes it as an input — a
// currency picker is configurability we'd have to support forever in
// exchange for nothing until the first non-US tenant.

const MONEY_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MONEY_PRECISE_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

type Numeric = number | string | { toString(): string };

function toNumber(value: Numeric | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

/** `$1,234.56` — totals and extended values. */
export function formatMoney(value: Numeric | null | undefined): string {
  const n = toNumber(value);
  return n == null ? "—" : MONEY_FMT.format(n);
}

/**
 * `$8.755` — unit prices, which carry up to four decimals in the schema and
 * are routinely negotiated in tenths of a cent. Rounding these to two would
 * silently misrepresent a price list.
 */
export function formatUnitPrice(value: Numeric | null | undefined): string {
  const n = toNumber(value);
  return n == null ? "—" : MONEY_PRECISE_FMT.format(n);
}

/**
 * `$1.4M` / `$310K` — aggregates only. The CFO sentence ("$310K sitting on a
 * supplier over two weeks") needs to read at a glance; the exact figure is
 * always one click away on the underlying list.
 */
export function formatMoneyCompact(value: Numeric | null | undefined): string {
  const n = toNumber(value);
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${trimZeros((n / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return MONEY_FMT.format(n);
}

function trimZeros(s: string): string {
  return s.replace(/\.0$/, "");
}

// --- Quantities ------------------------------------------------------------

/**
 * `500`, `12.5`, `0.25` — quantities are Decimal(14,4) and almost always
 * whole. Rendering `500.0000 EA` on every line of every PO is noise that
 * makes the one genuinely fractional quantity harder to spot, not easier.
 */
export function formatQuantity(value: Numeric | null | undefined): string {
  const n = toNumber(value);
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(n);
}

/** `500 EA` */
export function formatQuantityWithUom(value: Numeric | null | undefined, uom: string): string {
  const q = formatQuantity(value);
  return q === "—" ? q : `${q} ${uom}`;
}

/** `1,284` — counts in prose and column headers. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/** `line` / `lines`. Trivial, but it was being open-coded at nine call sites. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}
