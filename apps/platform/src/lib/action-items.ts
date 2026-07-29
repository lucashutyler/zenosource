import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { rfqDisplayNumber } from "@/lib/display";
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

// Resolves every OPEN action item for one or more subjects of the same type
// at once — for state transitions (e.g. cancellation, RFQ close/award) that
// make any pending action on those subjects moot, regardless of who owned
// it. Accepts an array so a PO cancellation can resolve both the PO's own
// items and every one of its lines' in one call, rather than needing a
// separate call per line id.
export async function resolveOpenActionItemsFor(
  subjectType: ActionItemSubjectType,
  subjectId: string | string[]
) {
  const ids = Array.isArray(subjectId) ? subjectId : [subjectId];
  if (ids.length === 0) return { count: 0 };
  return db.actionItem.updateMany({
    where: { subjectType, subjectId: { in: ids }, status: "OPEN" },
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

// What to show for an action item and where clicking it should take you.
// `subjectId` isn't a real FK (ActionItem is deliberately polymorphic — see
// docs/data-model.md#actionitem), so resolving "which work item is this"
// takes an extra lookup per subject type; all batched here rather than
// N+1'd per item. `identifier`/`detail` exist so a list of action items can
// say exactly which PO/RFQ/line each one concerns instead of just its type —
// PurchaseOrder has no human-readable number yet (docs/todo.md), so
// `identifier` falls back to the supplier name, which is unique enough to
// tell items apart in the common case.
export type ActionItemContext = {
  href: string | null;
  entityLabel: string;
  identifier: string | null;
  detail: string | null;
};

export async function resolveActionItemContext(
  items: { id: string; subjectType: ActionItemSubjectType; subjectId: string }[]
): Promise<Map<string, ActionItemContext>> {
  const lineIds = items
    .filter((i) => i.subjectType === "PURCHASE_ORDER_LINE")
    .map((i) => i.subjectId);
  const lines = lineIds.length
    ? await db.purchaseOrderLine.findMany({
        where: { id: { in: lineIds } },
        select: { id: true, purchaseOrderId: true, itemNumber: true, description: true },
      })
    : [];
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const directPoIds = items
    .filter((i) => i.subjectType === "PURCHASE_ORDER")
    .map((i) => i.subjectId);
  const poIds = [...new Set([...directPoIds, ...lines.map((l) => l.purchaseOrderId)])];
  const purchaseOrders = poIds.length
    ? await db.purchaseOrder.findMany({
        where: { id: { in: poIds } },
        select: { id: true, supplier: { select: { name: true } }, _count: { select: { lines: true } } },
      })
    : [];
  const poById = new Map(purchaseOrders.map((po) => [po.id, po]));

  const rfqIds = items.filter((i) => i.subjectType === "RFQ").map((i) => i.subjectId);
  const rfqs = rfqIds.length
    ? await db.rFQ.findMany({
        where: { id: { in: rfqIds } },
        select: { id: true, _count: { select: { lines: true, invites: true } } },
      })
    : [];
  const rfqById = new Map(rfqs.map((r) => [r.id, r]));

  const context = new Map<string, ActionItemContext>();
  for (const item of items) {
    switch (item.subjectType) {
      case "PURCHASE_ORDER": {
        const po = poById.get(item.subjectId);
        context.set(item.id, {
          href: `/dashboard/purchase-orders/${item.subjectId}`,
          entityLabel: "Purchase order",
          identifier: po?.supplier.name ?? null,
          detail: po ? `${po._count.lines} line${po._count.lines === 1 ? "" : "s"}` : null,
        });
        break;
      }
      case "PURCHASE_ORDER_LINE": {
        const line = lineById.get(item.subjectId);
        const po = line ? poById.get(line.purchaseOrderId) : undefined;
        context.set(item.id, {
          href: line
            ? `/dashboard/purchase-orders/${line.purchaseOrderId}?highlight=${line.id}`
            : null,
          entityLabel: "Purchase order line",
          identifier: po?.supplier.name ?? null,
          detail: line ? `${line.itemNumber} — ${line.description}` : null,
        });
        break;
      }
      case "RFQ": {
        const rfq = rfqById.get(item.subjectId);
        context.set(item.id, {
          href: `/dashboard/rfqs/${item.subjectId}`,
          entityLabel: "RFQ",
          identifier: rfqDisplayNumber(item.subjectId),
          detail: rfq
            ? `${rfq._count.lines} line${rfq._count.lines === 1 ? "" : "s"}, ${rfq._count.invites} supplier${rfq._count.invites === 1 ? "" : "s"} invited`
            : null,
        });
        break;
      }
      default:
        // PO_SUGGESTION has no page yet (Phase 2, Epicor-gated) — no link target.
        context.set(item.id, {
          href: null,
          entityLabel: "PO suggestion",
          identifier: null,
          detail: null,
        });
    }
  }
  return context;
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
