import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { StatusEventSubjectType } from "@/generated/prisma/enums";

// Every state change in the product goes through here.
//
// docs/product.md says the scorecards are "built on state-transition
// history". That history has to be written at the moment of the transition
// or it doesn't exist — there is no later job that can reconstruct how long
// a PO sat in ISSUED, and a customer who asks in November about September
// gets an apology rather than a number.
//
// The denormalized lifecycle timestamps (`PurchaseOrder.issuedAt`, `RFQ.
// awardedAt`, ...) are written by this same function rather than by callers,
// which is the only reason they can be trusted: two writers for one fact is
// a drift bug waiting for its first concurrent request.

export type StatusActor =
  | { type: "INTERNAL_USER"; userId: string; label: string }
  | { type: "EXTERNAL_USER"; contactId: string | null; label: string }
  | { type: "SYSTEM"; label?: string };

// Which entity column each terminal status stamps. Kept as data rather than
// branches so adding a status can't quietly skip its timestamp.
const PO_TIMESTAMP_COLUMN: Record<string, keyof Prisma.PurchaseOrderUpdateInput | undefined> = {
  ISSUED: "issuedAt",
  ACKNOWLEDGED: "acknowledgedAt",
  FULFILLED: "fulfilledAt",
  CLOSED: "closedAt",
  // CANCELLED and REJECTED already have their own columns, written alongside
  // their reason text by the actions that set them.
};

const RFQ_TIMESTAMP_COLUMN: Record<string, keyof Prisma.RFQUpdateInput | undefined> = {
  SENT: "sentAt",
  AWARDED: "awardedAt",
  CLOSED: "closedAt",
};

export async function recordStatusChange(params: {
  tenantId: string;
  subjectType: StatusEventSubjectType;
  subjectId: string;
  fromStatus: string | null;
  toStatus: string;
  actor: StatusActor;
  note?: string | null;
  occurredAt?: Date;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  const client = params.tx ?? db;
  const occurredAt = params.occurredAt ?? new Date();

  await client.statusEvent.create({
    data: {
      tenantId: params.tenantId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      actorType: params.actor.type,
      actorUserId: params.actor.type === "INTERNAL_USER" ? params.actor.userId : null,
      actorContactId: params.actor.type === "EXTERNAL_USER" ? params.actor.contactId : null,
      actorLabel: params.actor.label ?? null,
      note: params.note ?? null,
      occurredAt,
    },
  });

  if (params.subjectType === "PURCHASE_ORDER") {
    const column = PO_TIMESTAMP_COLUMN[params.toStatus];
    if (column) {
      await client.purchaseOrder.update({
        where: { id: params.subjectId },
        data: { [column]: occurredAt },
      });
    }
  } else if (params.subjectType === "RFQ") {
    const column = RFQ_TIMESTAMP_COLUMN[params.toStatus];
    if (column) {
      await client.rFQ.update({
        where: { id: params.subjectId },
        data: { [column]: occurredAt },
      });
    }
  }
}

export type PossessionSegment = {
  /** Whose court the work sat in for this stretch. */
  court: "BUYER" | "SUPPLIER" | "NOBODY";
  status: string;
  from: Date;
  to: Date;
  days: number;
};

// Which side owns a PO while it sits in each status. This is the same
// question the dashboard's "you owe / they owe" split asks, answered once.
const PO_COURT: Record<string, PossessionSegment["court"]> = {
  DRAFT: "BUYER",
  ISSUED: "SUPPLIER",
  ACKNOWLEDGED: "SUPPLIER",
  IN_PROGRESS: "SUPPLIER",
  REJECTED: "BUYER",
  FULFILLED: "BUYER",
  CLOSED: "NOBODY",
  CANCELLED: "NOBODY",
};

/**
 * Stitch an entity's status events into the contiguous segments the
 * possession strip draws — `[1d draft][0.2d you issued][11d them][2d you]`.
 *
 * Honest only once every transition writes an event, which is why the strip
 * is sequenced after the lifecycle work rather than beside it: drawn against
 * a partial log it would render gaps it can't explain, and a chart that
 * silently omits time is worse than no chart.
 */
export function buildPossessionSegments(
  events: { fromStatus: string | null; toStatus: string; occurredAt: Date }[],
  createdAt: Date,
  now: Date = new Date()
): PossessionSegment[] {
  if (events.length === 0) return [];
  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const segments: PossessionSegment[] = [];
  let segmentStart = createdAt;
  let currentStatus = ordered[0].fromStatus ?? "DRAFT";

  for (const event of ordered) {
    if (event.occurredAt > segmentStart) {
      segments.push(makeSegment(currentStatus, segmentStart, event.occurredAt));
    }
    segmentStart = event.occurredAt;
    currentStatus = event.toStatus;
  }

  // The open-ended tail: still sitting wherever the last transition left it.
  if (PO_COURT[currentStatus] !== "NOBODY") {
    segments.push(makeSegment(currentStatus, segmentStart, now));
  }

  return segments;
}

function makeSegment(status: string, from: Date, to: Date): PossessionSegment {
  return {
    court: PO_COURT[status] ?? "NOBODY",
    status,
    from,
    to,
    days: (to.getTime() - from.getTime()) / 86_400_000,
  };
}
