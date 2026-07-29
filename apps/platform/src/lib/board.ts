import "server-only";
import { db } from "@/lib/db";
import type { ActionItemSubjectType, ActionItemType } from "@/generated/prisma/enums";

// What a ledger row needs beyond the entity itself: whether anything is open
// on it, who owes it, and how long they've owed it.
//
// Every list in the product is a list of *work*, not of records, so this is
// the join that makes a list useful. Kept here rather than inline in each
// page because the "needs your action" dot previously forked from the
// dashboard inbox's own query and drifted — it lit up for items owned by the
// supplier or by a teammate, training users to ignore a dot that was usually
// not theirs.

export type OpenWork = {
  actionItemId: string;
  actionType: ActionItemType;
  openedAt: Date;
  ownedByViewer: boolean;
  ownerIsExternal: boolean;
  reminderCount: number;
  lastRemindedAt: Date | null;
  accessToken: string;
};

/**
 * The single open item that best represents each subject.
 *
 * "Best" is the oldest: a row shows the thing that has been waiting longest,
 * because that is the one that will be asked about. A PO can carry several
 * open items at once — a header acknowledgment plus two line-level change
 * proposals — and a row has one clock.
 */
export async function loadOpenWork(params: {
  tenantId: string;
  viewerId: string;
  subjectType: ActionItemSubjectType;
  subjectIds: string[];
}): Promise<Map<string, OpenWork>> {
  if (params.subjectIds.length === 0) return new Map();

  const items = await db.actionItem.findMany({
    where: {
      tenantId: params.tenantId,
      status: "OPEN",
      subjectType: params.subjectType,
      subjectId: { in: params.subjectIds },
    },
    orderBy: { openedAt: "asc" },
  });

  const bySubject = new Map<string, OpenWork>();
  for (const item of items) {
    if (bySubject.has(item.subjectId)) continue; // oldest wins
    bySubject.set(item.subjectId, {
      actionItemId: item.id,
      actionType: item.actionType,
      openedAt: item.openedAt,
      ownedByViewer:
        item.ownerType === "INTERNAL_USER" && item.internalOwnerId === params.viewerId,
      ownerIsExternal: item.ownerType === "EXTERNAL_USER",
      reminderCount: item.reminderCount,
      lastRemindedAt: item.lastRemindedAt,
      accessToken: item.accessToken,
    });
  }
  return bySubject;
}

/**
 * Line-level open work, rolled up to the parent PO.
 *
 * A change proposal is an item on a `PurchaseOrderLine`, but the list shows
 * purchase orders — without this rollup, an order whose only outstanding work
 * is a line-level proposal renders as having nothing open at all.
 */
export async function loadLineWorkByPurchaseOrder(params: {
  tenantId: string;
  viewerId: string;
  purchaseOrderIds: string[];
}): Promise<Map<string, OpenWork>> {
  if (params.purchaseOrderIds.length === 0) return new Map();

  const lines = await db.purchaseOrderLine.findMany({
    where: { purchaseOrderId: { in: params.purchaseOrderIds } },
    select: { id: true, purchaseOrderId: true },
  });
  const poByLine = new Map(lines.map((l) => [l.id, l.purchaseOrderId]));

  const lineWork = await loadOpenWork({
    tenantId: params.tenantId,
    viewerId: params.viewerId,
    subjectType: "PURCHASE_ORDER_LINE",
    subjectIds: lines.map((l) => l.id),
  });

  const byPo = new Map<string, OpenWork>();
  for (const [lineId, work] of lineWork) {
    const poId = poByLine.get(lineId);
    if (!poId) continue;
    const existing = byPo.get(poId);
    if (!existing || work.openedAt < existing.openedAt) byPo.set(poId, work);
  }
  return byPo;
}

/** Merge header-level and line-level work, keeping whichever has waited longer. */
export function mergeWork(
  a: Map<string, OpenWork>,
  b: Map<string, OpenWork>
): Map<string, OpenWork> {
  const merged = new Map(a);
  for (const [key, work] of b) {
    const existing = merged.get(key);
    if (!existing || work.openedAt < existing.openedAt) merged.set(key, work);
  }
  return merged;
}

// --- Pagination ------------------------------------------------------------
//
// Every list was an unbounded `findMany`, including the inbox. Fine against
// six seeded rows; a real tenant runs ~40 orders in flight and ~900 at rest,
// and the page would render all of them.

export const PAGE_SIZE = 50;

export function pageFrom(searchParams: { page?: string }): number {
  const page = Number(searchParams.page ?? 1);
  return Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
}

export function paginationRange(page: number, total: number) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  return {
    page: current,
    pages,
    skip: (current - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    from: total === 0 ? 0 : (current - 1) * PAGE_SIZE + 1,
    to: Math.min(current * PAGE_SIZE, total),
    total,
  };
}
