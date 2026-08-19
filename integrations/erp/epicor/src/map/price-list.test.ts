import { describe, it, expect } from "vitest";
import { mapPriceLists, priceListRefFor } from "./price-list";

// docs/integrations.md: "There is no clean, single 'PriceList' service in
// Epicor — pricing lives on the vendor-part relationship... Expect to
// reconcile this into ZenoSource's own PriceList/PriceBreak shape."

const part = (over: Record<string, unknown> = {}) => ({
  VendorNum: 42,
  PartNum: "SKU-2050",
  PartDescription: "Housing",
  PUM: "EA",
  BasePrice: 44,
  ...over,
});

describe("reconciling vendor-parts into price lists", () => {
  it("groups every part for a supplier into one stable list", () => {
    const lists = mapPriceLists([part(), part({ PartNum: "SKU-1001" })]);
    expect(lists).toHaveLength(1);
    expect(lists[0].items).toHaveLength(2);
    // Stable across runs, so a re-sync updates rather than duplicating.
    expect(lists[0].externalRef).toBe(priceListRefFor("42"));
  });

  it("separates suppliers", () => {
    const lists = mapPriceLists([part(), part({ VendorNum: 7 })]);
    expect(lists).toHaveLength(2);
  });

  it("turns a flat base price into a break at quantity 1", () => {
    // ZenoSource has no "base price" concept — it has a break starting at 1.
    // Without this, a flat-priced part imports with no price at all, and the
    // PO-create prefill (rated the highest-value item in the Phase 1b design
    // review) has nothing to prefill from.
    const [list] = mapPriceLists([part()]);
    expect(list.items[0].breaks).toEqual([{ minQuantity: 1, unitPrice: "44.0000", currency: "USD" }]);
  });

  it("builds a stepped schedule from quantity breaks, ascending", () => {
    const [list] = mapPriceLists([
      part({
        BasePrice: 44,
        VendPBrks: [
          { Quantity: 1000, UnitPrice: 8.755 },
          { Quantity: 250, UnitPrice: 12.5 },
        ],
      }),
    ]);
    expect(list.items[0].breaks.map((b) => b.minQuantity)).toEqual([1, 250, 1000]);
    expect(list.items[0].breaks[2].unitPrice).toBe("8.7550");
  });

  it("lets an explicit break win over a colliding base price", () => {
    // Phase 1b Wave 5 put a duplicate-guard on break min-quantity in the UI.
    // An import must not be the back door around it.
    const [list] = mapPriceLists([part({ BasePrice: 44, VendPBrks: [{ Quantity: 1, UnitPrice: 40 }] })]);
    expect(list.items[0].breaks).toHaveLength(1);
    expect(list.items[0].breaks[0].unitPrice).toBe("40.0000");
  });

  it("widens effectivity across a supplier's parts rather than narrowing it", () => {
    // Epicor dates effectivity per vendor-part; ZenoSource dates it per list.
    // Taking the narrowest window would expire prices that are still live.
    const [list] = mapPriceLists([
      part({ EffectiveDate: "2026-03-01T00:00:00Z", ExpirationDate: "2026-09-01T00:00:00Z" }),
      part({ PartNum: "SKU-1001", EffectiveDate: "2026-01-01T00:00:00Z", ExpirationDate: "2026-12-31T00:00:00Z" }),
    ]);
    expect(list.effectiveFrom).toBe("2026-01-01");
    expect(list.effectiveTo).toBe("2026-12-31");
  });

  it("drops a part with no usable price rather than listing it at nothing", () => {
    expect(mapPriceLists([part({ BasePrice: null })])).toHaveLength(0);
  });
});
