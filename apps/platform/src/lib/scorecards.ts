import "server-only";
import { db } from "@/lib/db";

// The metrics docs/product.md promises, pinned.
//
// Every one is derived from the fixed state machines and the transition
// history — no configuration, no metric picker, no report builder. That's the
// product philosophy applied to reporting: a scorecard whose contents are
// negotiable is a scorecard nobody trusts, because two people looking at
// "supplier performance" would be looking at different numbers.
//
// The window is fixed at 90 days for the same reason.

export const SCORECARD_WINDOW_DAYS = 90;

export type SupplierScore = {
  supplierId: string;
  name: string;
  /** Median hours from issue to acknowledgment. */
  ackLatencyHours: number | null;
  ordersIssued: number;
  ordersAcknowledged: number;
  ordersRejected: number;
  /** Of orders received, the share that arrived on or before the promise. */
  onTimePct: number | null;
  ordersReceived: number;
  /** Share of issued orders where they proposed a change to at least one line. */
  changeProposalPct: number | null;
  /** Average days a proposal pushed the date out. */
  averageDateSlipDays: number | null;
  rfqsInvited: number;
  rfqsQuoted: number;
  rfqsDeclined: number;
  /** Median hours from RFQ send to their quote. */
  quoteTurnaroundHours: number | null;
  /** Days their oldest still-open item has been waiting. */
  oldestOpenDays: number | null;
  openItems: number;
  /** What they're currently holding, in dollars. */
  openValue: number;
  /** Share of resolved items answered without a second chase. */
  firstChaseSuccessPct: number | null;
};

export type BuyerScore = {
  internalUserId: string;
  name: string;
  /** Median hours from item opening to resolution, across all types. */
  resolutionLatencyHours: number | null;
  resolved: number;
  open: number;
  oldestOpenDays: number | null;
  /** Median hours from draft creation to issue. */
  draftToIssueHours: number | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000;
}

function pct(part: number, whole: number): number | null {
  return whole === 0 ? null : (part / whole) * 100;
}

export async function supplierScorecard(
  tenantId: string,
  now: Date = new Date()
): Promise<SupplierScore[]> {
  const since = new Date(now.getTime() - SCORECARD_WINDOW_DAYS * 86_400_000);

  const suppliers = await db.supplier.findMany({
    where: { tenantId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const orders = await db.purchaseOrder.findMany({
    where: { tenantId, createdAt: { gte: since } },
    select: {
      id: true,
      supplierId: true,
      status: true,
      issuedAt: true,
      acknowledgedAt: true,
      fulfilledAt: true,
      totalValue: true,
      lines: {
        select: {
          id: true,
          promiseDate: true,
          needByDate: true,
          receivedAt: true,
          changeProposals: { select: { previousDate: true, proposedDate: true } },
        },
      },
    },
  });

  const invites = await db.rFQSupplierInvite.findMany({
    where: { rfq: { tenantId, createdAt: { gte: since } } },
    select: {
      supplierId: true,
      status: true,
      respondedAt: true,
      declinedAt: true,
      rfq: { select: { sentAt: true } },
    },
  });

  const openItems = await db.actionItem.findMany({
    where: { tenantId, status: "OPEN", ownerType: "EXTERNAL_USER" },
    select: {
      subjectId: true,
      subjectType: true,
      openedAt: true,
      externalOwner: { select: { supplierId: true } },
    },
  });

  const resolvedItems = await db.actionItem.findMany({
    where: {
      tenantId,
      status: "RESOLVED",
      ownerType: "EXTERNAL_USER",
      resolvedAt: { gte: since },
    },
    select: { reminderCount: true, externalOwner: { select: { supplierId: true } } },
  });

  const orderValueById = new Map(orders.map((o) => [o.id, Number(o.totalValue)]));

  return suppliers.map((supplier) => {
    const theirs = orders.filter((o) => o.supplierId === supplier.id);
    const issued = theirs.filter((o) => o.issuedAt != null);
    const acknowledged = issued.filter((o) => o.acknowledgedAt != null);
    const rejected = theirs.filter((o) => o.status === "REJECTED");

    const ackLatency = acknowledged.map((o) => hoursBetween(o.issuedAt!, o.acknowledgedAt!));

    // On time is measured against the promise the supplier made, falling back
    // to the buyer's need-by when they never gave one — otherwise a supplier
    // who declines to promise anything scores perfectly.
    const receivedLines = theirs.flatMap((o) =>
      o.lines.filter((l) => l.receivedAt != null).map((l) => ({ ...l, order: o }))
    );
    const onTime = receivedLines.filter((l) => {
      const target = l.promiseDate ?? l.needByDate;
      return target ? l.receivedAt! <= target : false;
    });

    const withProposals = issued.filter((o) => o.lines.some((l) => l.changeProposals.length > 0));
    const slips = theirs.flatMap((o) =>
      o.lines.flatMap((l) =>
        l.changeProposals
          .filter((p) => p.previousDate && p.proposedDate)
          .map((p) => (p.proposedDate!.getTime() - p.previousDate!.getTime()) / 86_400_000)
      )
    );

    const theirInvites = invites.filter((i) => i.supplierId === supplier.id);
    const quoted = theirInvites.filter((i) => i.status === "RESPONDED");
    const declined = theirInvites.filter((i) => i.status === "DECLINED");
    const turnaround = quoted
      .filter((i) => i.rfq.sentAt && i.respondedAt)
      .map((i) => hoursBetween(i.rfq.sentAt!, i.respondedAt!));

    const theirOpen = openItems.filter((i) => i.externalOwner?.supplierId === supplier.id);
    const oldestOpen = theirOpen.reduce<Date | null>(
      (oldest, item) => (!oldest || item.openedAt < oldest ? item.openedAt : oldest),
      null
    );
    const openValue = theirOpen.reduce(
      (sum, item) =>
        sum + (item.subjectType === "PURCHASE_ORDER" ? (orderValueById.get(item.subjectId) ?? 0) : 0),
      0
    );

    // The number that renews the contract: "84% of your suppliers responded
    // without a second chase, up from 61%." Computable from ActionItem
    // history alone — no ML, no new tables.
    const theirResolved = resolvedItems.filter((i) => i.externalOwner?.supplierId === supplier.id);
    const firstTime = theirResolved.filter((i) => i.reminderCount <= 1);

    return {
      supplierId: supplier.id,
      name: supplier.name,
      ackLatencyHours: median(ackLatency),
      ordersIssued: issued.length,
      ordersAcknowledged: acknowledged.length,
      ordersRejected: rejected.length,
      onTimePct: pct(onTime.length, receivedLines.length),
      ordersReceived: receivedLines.length,
      changeProposalPct: pct(withProposals.length, issued.length),
      averageDateSlipDays:
        slips.length === 0 ? null : slips.reduce((a, b) => a + b, 0) / slips.length,
      rfqsInvited: theirInvites.length,
      rfqsQuoted: quoted.length,
      rfqsDeclined: declined.length,
      quoteTurnaroundHours: median(turnaround),
      oldestOpenDays: oldestOpen ? (now.getTime() - oldestOpen.getTime()) / 86_400_000 : null,
      openItems: theirOpen.length,
      openValue,
      firstChaseSuccessPct: pct(firstTime.length, theirResolved.length),
    };
  });
}

export async function buyerScorecard(
  tenantId: string,
  now: Date = new Date()
): Promise<BuyerScore[]> {
  const since = new Date(now.getTime() - SCORECARD_WINDOW_DAYS * 86_400_000);

  const users = await db.internalUser.findMany({
    where: { tenantId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const resolved = await db.actionItem.findMany({
    where: {
      tenantId,
      ownerType: "INTERNAL_USER",
      status: "RESOLVED",
      resolvedAt: { gte: since },
    },
    select: { internalOwnerId: true, openedAt: true, resolvedAt: true },
  });

  const open = await db.actionItem.findMany({
    where: { tenantId, ownerType: "INTERNAL_USER", status: "OPEN" },
    select: { internalOwnerId: true, openedAt: true },
  });

  // Draft-to-issue latency, from the transition log — the one metric that
  // measures our own side's drag rather than a supplier's.
  const draftEvents = await db.statusEvent.findMany({
    where: {
      tenantId,
      subjectType: "PURCHASE_ORDER",
      toStatus: { in: ["DRAFT", "ISSUED"] },
      occurredAt: { gte: since },
    },
    select: { subjectId: true, toStatus: true, occurredAt: true, actorUserId: true },
    orderBy: { occurredAt: "asc" },
  });
  const draftedAt = new Map<string, Date>();
  const issueLatencyByUser = new Map<string, number[]>();
  for (const event of draftEvents) {
    if (event.toStatus === "DRAFT") {
      draftedAt.set(event.subjectId, event.occurredAt);
    } else if (event.toStatus === "ISSUED") {
      const drafted = draftedAt.get(event.subjectId);
      if (drafted && event.actorUserId) {
        const list = issueLatencyByUser.get(event.actorUserId) ?? [];
        list.push(hoursBetween(drafted, event.occurredAt));
        issueLatencyByUser.set(event.actorUserId, list);
      }
    }
  }

  return users.map((user) => {
    const theirResolved = resolved.filter((i) => i.internalOwnerId === user.id);
    const theirOpen = open.filter((i) => i.internalOwnerId === user.id);
    const oldest = theirOpen.reduce<Date | null>(
      (o, item) => (!o || item.openedAt < o ? item.openedAt : o),
      null
    );

    return {
      internalUserId: user.id,
      name: user.name,
      resolutionLatencyHours: median(
        theirResolved.map((i) => hoursBetween(i.openedAt, i.resolvedAt!))
      ),
      resolved: theirResolved.length,
      open: theirOpen.length,
      oldestOpenDays: oldest ? (now.getTime() - oldest.getTime()) / 86_400_000 : null,
      draftToIssueHours: median(issueLatencyByUser.get(user.id) ?? []),
    };
  });
}

/** Median hours from RFQ send to award, across the window. */
export async function rfqCycleTimeHours(
  tenantId: string,
  now: Date = new Date()
): Promise<number | null> {
  const since = new Date(now.getTime() - SCORECARD_WINDOW_DAYS * 86_400_000);
  const rfqs = await db.rFQ.findMany({
    where: { tenantId, awardedAt: { gte: since }, sentAt: { not: null } },
    select: { sentAt: true, awardedAt: true },
  });
  return median(rfqs.map((r) => hoursBetween(r.sentAt!, r.awardedAt!)));
}
