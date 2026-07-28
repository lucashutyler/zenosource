import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type {
  ActionItemOwnerType,
  ActionItemSubjectType,
  ActionItemType,
} from "@/generated/prisma/enums";

function generateAccessToken() {
  return randomBytes(32).toString("hex");
}

// Every state-bearing entity resolves to at most one open ActionItem — see
// docs/architecture.md#action-items--reminders. Callers should only ever
// create one through a state transition, never freestanding.
export async function createActionItem(params: {
  tenantId: string;
  subjectType: ActionItemSubjectType;
  subjectId: string;
  actionType: ActionItemType;
  ownerType: ActionItemOwnerType;
  internalOwnerId?: string;
  externalOwnerId?: string;
}) {
  return db.actionItem.create({
    data: {
      tenantId: params.tenantId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      actionType: params.actionType,
      ownerType: params.ownerType,
      internalOwnerId: params.internalOwnerId,
      externalOwnerId: params.externalOwnerId,
      accessToken: generateAccessToken(),
    },
  });
}

export async function resolveActionItem(id: string) {
  return db.actionItem.update({
    where: { id },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
}

// Atomic "resolve if still open" — the guard against double-actioning. An
// action item can be visible to more than one team member (an OWNER can see
// everything; a specific item is only *assigned* to one owner, but that's
// not the same as only one person having access to it), and a supplier's
// no-login link can be opened twice. Whoever's write actually flips
// status OPEN -> RESOLVED wins; everyone else gets count 0 and must treat
// the action as already handled, not retry the underlying mutation.
export async function tryResolveActionItem(id: string): Promise<boolean> {
  const result = await db.actionItem.updateMany({
    where: { id, status: "OPEN" },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
  return result.count > 0;
}

// Resolves every OPEN action item for a subject at once — for state
// transitions (e.g. cancellation) that make any pending action on that
// subject moot, regardless of who owned it.
export async function resolveOpenActionItemsFor(
  subjectType: ActionItemSubjectType,
  subjectId: string
) {
  return db.actionItem.updateMany({
    where: { subjectType, subjectId, status: "OPEN" },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
}

export function countOpenActionItemsForInternalUser(internalUserId: string) {
  return db.actionItem.count({
    where: { internalOwnerId: internalUserId, status: "OPEN" },
  });
}

export function listOpenActionItemsForInternalUser(internalUserId: string) {
  return db.actionItem.findMany({
    where: { internalOwnerId: internalUserId, status: "OPEN" },
    orderBy: { openedAt: "asc" },
  });
}

// Where clicking an action item should take you. `subjectId` isn't a real
// FK (ActionItem is deliberately polymorphic — see docs/data-model.md
// #actionitem), so a PURCHASE_ORDER_LINE subject needs an extra lookup to
// find its parent PO; batched here rather than N+1'd per item. The
// PurchaseOrder link carries `?highlight=<lineId>` so the detail page can
// visually point at the specific line the action is about.
export async function resolveActionItemHrefs(
  items: { id: string; subjectType: ActionItemSubjectType; subjectId: string }[]
): Promise<Map<string, string | null>> {
  const lineIds = items
    .filter((i) => i.subjectType === "PURCHASE_ORDER_LINE")
    .map((i) => i.subjectId);
  const lines = lineIds.length
    ? await db.purchaseOrderLine.findMany({
        where: { id: { in: lineIds } },
        select: { id: true, purchaseOrderId: true },
      })
    : [];
  const lineToPO = new Map(lines.map((l) => [l.id, l.purchaseOrderId]));

  const hrefs = new Map<string, string | null>();
  for (const item of items) {
    switch (item.subjectType) {
      case "PURCHASE_ORDER":
        hrefs.set(item.id, `/dashboard/purchase-orders/${item.subjectId}`);
        break;
      case "PURCHASE_ORDER_LINE": {
        const poId = lineToPO.get(item.subjectId);
        hrefs.set(
          item.id,
          poId ? `/dashboard/purchase-orders/${poId}?highlight=${item.subjectId}` : null
        );
        break;
      }
      case "RFQ":
        hrefs.set(item.id, `/dashboard/rfqs/${item.subjectId}`);
        break;
      default:
        // PO_SUGGESTION has no page yet (Phase 2, Epicor-gated) — no link target.
        hrefs.set(item.id, null);
    }
  }
  return hrefs;
}

// The scoped, no-login "action view" link — see docs/architecture.md
// #action-items--reminders. Valid as long as the item stays OPEN; not
// single-use, not separately time-limited.
export function findOpenActionItemByToken(accessToken: string) {
  return db.actionItem.findFirst({
    where: { accessToken, status: "OPEN" },
    include: { externalOwner: { include: { supplier: true } } },
  });
}
