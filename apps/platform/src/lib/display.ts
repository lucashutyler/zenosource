// RFQ has no human-readable number field yet (see docs/todo.md's Identity
// and context group) — this stand-in derives a short, stable label from the
// cuid so it reads as an identifier rather than a raw id. Shared so the
// three places that show it (RFQ list, RFQ detail, dashboard inbox) can't
// drift out of sync with each other.
export function rfqDisplayNumber(rfqId: string): string {
  return `RFQ-${rfqId.slice(-6).toUpperCase()}`;
}
