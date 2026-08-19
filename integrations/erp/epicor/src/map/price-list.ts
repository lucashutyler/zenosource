import type { CanonicalPriceBreak, CanonicalPriceList, CanonicalPriceListItem } from "../types";
import { dateOnly, decimalString, field, int, text } from "./scalars";

// Erp.BO.VendPartSvc -> PriceList / PriceListItem / PriceBreak.
//
// docs/integrations.md#epicor-erp: "There is no clean, single 'PriceList'
// service in Epicor — pricing lives on the vendor-part relationship, and
// integrators consistently land on VendPartSvc rather than the more ambiguous
// PriceLstSvc. Expect to reconcile this into ZenoSource's own
// PriceList/PriceBreak shape rather than mirroring Epicor's naming."
//
// So the reconciliation is: Epicor has vendor-part rows, each with quantity
// break children. ZenoSource has one price list per supplier holding many
// items, each with many breaks. One synthetic price list per supplier per
// sync is the mapping — `epicor:vendor:{VendorNum}` as its external ref, which
// makes it stable across runs and therefore updatable rather than duplicated.

export function priceListRefFor(supplierExternalRef: string): string {
  return `epicor:vendor:${supplierExternalRef}`;
}

/**
 * Groups flat VendPart rows into one price list per supplier.
 *
 * Takes the whole page at once rather than mapping row-by-row because the
 * grouping is the mapping — a single VendPart row is not a price list and
 * cannot be turned into one in isolation.
 */
export function mapPriceLists(rows: Record<string, unknown>[]): CanonicalPriceList[] {
  const bySupplier = new Map<string, CanonicalPriceListItem[]>();
  const effective = new Map<string, { from?: string; to?: string }>();

  for (const row of rows) {
    const supplierExternalRef = text(field(row, "VendorNum"));
    const itemNumber = text(field(row, "PartNum", "VenPartNum"));
    if (!supplierExternalRef || !itemNumber) continue;

    const breaks = mapBreaks(row);
    if (breaks.length === 0) continue;

    const item: CanonicalPriceListItem = {
      itemNumber,
      description: text(field(row, "PartDescription", "VenPartDescription", "Description")) ?? itemNumber,
      uom: text(field(row, "PUM", "IUM", "UOMCode")) ?? "EA",
      breaks,
    };

    const bucket = bySupplier.get(supplierExternalRef);
    if (bucket) bucket.push(item);
    else bySupplier.set(supplierExternalRef, [item]);

    // Epicor dates effectivity per vendor-part; ZenoSource dates it per list.
    // The widest window across the supplier's parts is the only honest
    // collapse — narrowing it would expire prices that are still live.
    const from = dateOnly(field(row, "EffectiveDate", "StartDate"));
    const to = dateOnly(field(row, "ExpirationDate", "EndDate"));
    const current = effective.get(supplierExternalRef) ?? {};
    if (from && (!current.from || from < current.from)) current.from = from;
    if (to && (!current.to || to > current.to)) current.to = to;
    effective.set(supplierExternalRef, current);
  }

  return [...bySupplier.entries()].map(([supplierExternalRef, items]) => ({
    externalRef: priceListRefFor(supplierExternalRef),
    supplierExternalRef,
    effectiveFrom: effective.get(supplierExternalRef)?.from ?? null,
    effectiveTo: effective.get(supplierExternalRef)?.to ?? null,
    items,
  }));
}

/**
 * A vendor part carries a base price and, separately, quantity break rows.
 * ZenoSource's model has no "base price" — it has a break starting at
 * quantity 1 — so the base price becomes exactly that. Without it, a part
 * priced flat with no breaks would import with no price at all, and the
 * PO-create price prefill (the single highest-value item in the Phase 1b
 * design review) would have nothing to prefill from.
 */
function mapBreaks(row: Record<string, unknown>): CanonicalPriceBreak[] {
  const breaks: CanonicalPriceBreak[] = [];
  const currency = text(field(row, "CurrencyCode", "CurrCode")) ?? "USD";

  const base = decimalString(field(row, "BasePrice", "UnitPrice", "DocBasePrice"));
  if (base) breaks.push({ minQuantity: 1, unitPrice: base, currency });

  const children = field<unknown[]>(row, "VendPBrks", "VendPartPrcBrks", "PriceBreaks");
  if (Array.isArray(children)) {
    for (const child of children) {
      if (typeof child !== "object" || child === null) continue;
      const record = child as Record<string, unknown>;
      const minQuantity = int(field(record, "Quantity", "BreakQty", "MinimumQty"));
      const unitPrice = decimalString(field(record, "UnitPrice", "BreakPrice", "DocUnitPrice"));
      if (minQuantity === undefined || minQuantity < 1 || !unitPrice) continue;
      breaks.push({ minQuantity, unitPrice, currency });
    }
  }

  // Ascending by quantity, deduplicated on min-quantity — Phase 1b Wave 5 put
  // a duplicate-guard on break min-quantity in the UI, and an import must not
  // be the back door around it. Later wins: a break row is more specific than
  // the base price it collides with.
  const byQuantity = new Map<number, CanonicalPriceBreak>();
  for (const entry of breaks) byQuantity.set(entry.minQuantity, entry);
  return [...byQuantity.values()].sort((a, b) => a.minQuantity - b.minQuantity);
}
