import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ActionItemOwnerType,
  ActionItemSubjectType,
  ActionItemType,
} from "@/generated/prisma/enums";

function generateAccessToken() {
  return randomBytes(32).toString("hex");
}

// A short, speakable code for the same grant — `7QK2-M4RD`.
//
// The 64-hex token stays in the href and is the only thing that authorizes
// anything. This is what a human reads: it goes in the email body and on the
// action view so a supplier can find the right message on the phone, or read
// it to a colleague. The audit found the raw token rendered visibly, which
// looks like malware, cannot be read aloud, and was single-handedly
// responsible for the external email view overflowing a phone by 83%.
//
// Crockford's alphabet minus the characters that get misheard or mistyped
// (I/L/O/U, and 0/1 with them), so "seven-Q-K-two" survives a bad line.
const CLAIM_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function claimCodeFor(accessToken: string): string {
  // Derived, not stored: same token always yields the same code, and a code
  // alone can't be reversed into a token because it's a lossy projection of
  // one — 8 characters of a 64-hex secret.
  let code = "";
  for (let i = 0; i < 8; i++) {
    const byte = parseInt(accessToken.slice(i * 2, i * 2 + 2), 16) || 0;
    code += CLAIM_ALPHABET[byte % CLAIM_ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// Every state-bearing entity resolves to at most one open ActionItem — see
// docs/architecture.md#action-items--reminders. Callers should only ever
// create one through a state transition, never freestanding.
export async function createActionItem(
  params: {
    tenantId: string;
    subjectType: ActionItemSubjectType;
    subjectId: string;
    actionType: ActionItemType;
    ownerType: ActionItemOwnerType;
    internalOwnerId?: string;
    externalOwnerId?: string;
  },
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? db;
  return client.actionItem.create({
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
export async function tryResolveActionItem(
  id: string,
  resolvedBy?: { internalUserId?: string; contactId?: string }
): Promise<boolean> {
  const result = await db.actionItem.updateMany({
    where: { id, status: "OPEN" },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedByInternalUserId: resolvedBy?.internalUserId ?? null,
      resolvedByContactId: resolvedBy?.contactId ?? null,
    },
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
  subjectId: string | string[],
  options?: {
    /** Narrow to one kind, e.g. resolve only PO_ISSUE_DRAFT on issue. */
    actionType?: ActionItemType | ActionItemType[];
    resolvedBy?: { internalUserId?: string; contactId?: string };
    tx?: Prisma.TransactionClient;
  }
) {
  const ids = Array.isArray(subjectId) ? subjectId : [subjectId];
  if (ids.length === 0) return { count: 0 };
  const client = options?.tx ?? db;
  const actionType = options?.actionType;
  return client.actionItem.updateMany({
    where: {
      subjectType,
      subjectId: { in: ids },
      status: "OPEN",
      ...(actionType
        ? { actionType: Array.isArray(actionType) ? { in: actionType } : actionType }
        : {}),
    },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedByInternalUserId: options?.resolvedBy?.internalUserId ?? null,
      resolvedByContactId: options?.resolvedBy?.contactId ?? null,
    },
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

/**
 * Every open item the supplier side owes this tenant. The "they owe 11" half
 * of the dashboard — a view that did not exist anywhere in the product, and
 * is the answer to the question the product exists to answer.
 */
export function listOpenExternalActionItems(tenantId: string) {
  return db.actionItem.findMany({
    where: { tenantId, status: "OPEN", ownerType: "EXTERNAL_USER" },
    include: { externalOwner: { include: { supplier: true } } },
    orderBy: { openedAt: "asc" },
  });
}

// What to show for an action item and where clicking it should take you.
// `subjectId` isn't a real FK (ActionItem is deliberately polymorphic — see
// docs/data-model.md#actionitem), so resolving "which work item is this"
// takes an extra lookup per subject type; all batched here rather than
// N+1'd per item.
export type ActionItemContext = {
  href: string | null;
  entityLabel: string;
  /** The document number — `P-10418`. */
  identifier: string | null;
  /** Who the other party is, for the whose-court read. */
  supplierName: string | null;
  detail: string | null;
  /** Order value, for the dwell x value ranking. */
  value: number | null;
  needByDate: Date | null;
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
        select: {
          id: true,
          purchaseOrderId: true,
          itemNumber: true,
          description: true,
          quantity: true,
          unitPrice: true,
          needByDate: true,
        },
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
        select: {
          id: true,
          number: true,
          totalValue: true,
          supplier: { select: { name: true } },
          _count: { select: { lines: true } },
          lines: { select: { needByDate: true }, orderBy: { needByDate: "asc" }, take: 1 },
        },
      })
    : [];
  const poById = new Map(purchaseOrders.map((po) => [po.id, po]));

  const rfqIds = items.filter((i) => i.subjectType === "RFQ").map((i) => i.subjectId);
  const rfqs = rfqIds.length
    ? await db.rFQ.findMany({
        where: { id: { in: rfqIds } },
        select: {
          id: true,
          number: true,
          quoteDeadline: true,
          _count: { select: { lines: true, invites: true } },
        },
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
          identifier: po?.number ?? null,
          supplierName: po?.supplier.name ?? null,
          detail: po ? `${po._count.lines} line${po._count.lines === 1 ? "" : "s"}` : null,
          value: po ? Number(po.totalValue) : null,
          needByDate: po?.lines[0]?.needByDate ?? null,
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
          identifier: po?.number ?? null,
          supplierName: po?.supplier.name ?? null,
          detail: line ? `${line.itemNumber} — ${line.description}` : null,
          // Line-level items rank on the line's own extended value, not the
          // whole order's: a proposed change on one $200 line of a $90,000
          // order is a $200 decision.
          value: line ? Number(line.quantity) * Number(line.unitPrice) : null,
          needByDate: line?.needByDate ?? null,
        });
        break;
      }
      case "RFQ": {
        const rfq = rfqById.get(item.subjectId);
        context.set(item.id, {
          href: `/dashboard/rfqs/${item.subjectId}`,
          entityLabel: "RFQ",
          identifier: rfq?.number ?? null,
          supplierName: null,
          detail: rfq
            ? `${rfq._count.lines} line${rfq._count.lines === 1 ? "" : "s"}, ${rfq._count.invites} supplier${rfq._count.invites === 1 ? "" : "s"} invited`
            : null,
          // An RFQ has no committed value yet — that is the point of it.
          value: null,
          needByDate: rfq?.quoteDeadline ?? null,
        });
        break;
      }
      case "PO_SUGGESTION":
        context.set(item.id, {
          href: "/dashboard/po-suggestions",
          entityLabel: "PO suggestion",
          identifier: null,
          supplierName: null,
          detail: null,
          value: null,
          needByDate: null,
        });
        break;

      case "INTEGRATION_CONNECTION":
        // These two used to fall through to a `default:` that labelled every
        // non-document subject "PO suggestion" with no link. It was invisible
        // while nothing had ever been DEGRADED, and Phase 3 makes it bite: the
        // one item an owner most needs a single click to reach is a broken
        // sign-in connection, and an unlabelled row that goes nowhere is not
        // the "open action owned by someone" docs/architecture.md means.
        context.set(item.id, {
          href: "/dashboard/integrations",
          entityLabel: "Integration",
          identifier: null,
          supplierName: null,
          detail: null,
          value: null,
          needByDate: null,
        });
        break;
    }
  }
  return context;
}

/**
 * The ordering rule for anything that shows a queue: dwell weighted by what's
 * at stake.
 *
 * Straight dwell descending is the obvious implementation and is wrong in the
 * one case that matters — it puts a 40-day-old $200 order above a 4-day-old
 * $80,000 one, and no buyer alive works that queue in that order. Value alone
 * is equally wrong: it never surfaces the small thing that has been rotting
 * for six weeks.
 *
 * Log-scaling the value keeps dwell as the primary axis (a week of waiting
 * outranks a 10x price difference) while letting an order two orders of
 * magnitude larger jump the queue. Deliberately not exposed as a sort option:
 * there is one right order for a chase product and it isn't the user's to
 * choose.
 */
export function chaseRank(item: { openedAt: Date }, value: number | null, now = new Date()): number {
  const days = Math.max(0, (now.getTime() - item.openedAt.getTime()) / 86_400_000);
  const stake = Math.log10(Math.max(100, value ?? 100));
  return days * stake;
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
