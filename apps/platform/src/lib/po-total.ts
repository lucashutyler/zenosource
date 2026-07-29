import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

// `PurchaseOrder.totalValue` is denormalized, which is a decision that has to
// justify itself. It does: the product's third standing law is "rank by dwell
// x value, not dwell" — a 40-day-old $200 PO and a 4-day-old $80,000 PO
// render identically today, and every buyer chases the second one first. That
// ordering has to happen in the database, because a tenant with 900 orders
// can't fetch every line to sort a list, and the CFO sentence ("$310K sitting
// on a supplier over two weeks") is a SUM over the same column.
//
// The cost of denormalizing is drift, so there is exactly one writer: this
// function, called by every path that touches lines.

/**
 * Recompute and store a PO's total from its lines. Pass `tx` to keep it in
 * the same transaction as the line write that made it stale — a total that
 * is briefly wrong is a number someone will screenshot.
 */
export async function refreshPurchaseOrderTotal(
  purchaseOrderId: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx ?? db;
  const lines = await client.purchaseOrderLine.findMany({
    where: { purchaseOrderId, status: { not: "CANCELLED" } },
    select: { quantity: true, unitPrice: true },
  });
  const total = lines.reduce(
    (sum, line) => sum + Number(line.quantity) * Number(line.unitPrice),
    0
  );
  await client.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { totalValue: total },
  });
}

/** The same arithmetic, for lines that aren't in the database yet. */
export function totalOf(
  lines: { quantity: number | string; unitPrice: number | string }[]
): number {
  return lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0);
}
