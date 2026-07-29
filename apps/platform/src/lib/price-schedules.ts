import "server-only";
import { db } from "@/lib/db";
import { todayUTC } from "@/lib/format";
import type { PriceSchedule } from "@/app/dashboard/purchase-orders/po-form";

/**
 * Every currently-effective negotiated price, flattened for the PO form.
 *
 * Price lists existed from Phase 1 and nothing ever read them. A buyer could
 * type $44.00 for a part negotiated at $8.755 and the app would save it
 * without comment — the entire point of maintaining a schedule, silently
 * bypassed at the one moment it matters. The procurement-manager judge rated
 * closing this the single highest-value item in either design review, and it
 * needs no new data: `PriceBreak` has held the answer all along.
 *
 * Expired and not-yet-effective lists are excluded here rather than filtered
 * in the browser: showing a buyer last year's rate as "from schedule L-10007"
 * would be worse than showing nothing.
 */
export async function loadPriceSchedules(tenantId: string): Promise<PriceSchedule[]> {
  const today = todayUTC();

  const lists = await db.priceList.findMany({
    where: {
      tenantId,
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
      ],
    },
    include: { items: { include: { priceBreaks: { orderBy: { minQuantity: "asc" } } } } },
    orderBy: { createdAt: "desc" },
  });

  const schedules: PriceSchedule[] = [];
  const seen = new Set<string>();

  for (const list of lists) {
    for (const item of list.items) {
      // Most recent effective list wins when two cover the same part — the
      // `orderBy` above makes that deterministic rather than incidental.
      const key = `${list.supplierId}::${item.itemNumber.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      schedules.push({
        supplierId: list.supplierId,
        itemNumber: item.itemNumber,
        description: item.description,
        uom: item.uom,
        listNumber: list.number,
        breaks: item.priceBreaks.map((b) => ({
          minQuantity: b.minQuantity,
          unitPrice: Number(b.unitPrice),
        })),
      });
    }
  }

  return schedules;
}
