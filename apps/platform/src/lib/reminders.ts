import type { PrismaClient } from "@/generated/prisma/client";
import type { EmailSender } from "@/lib/email/sender";
import { ACTION_COPY } from "@/lib/lifecycle";
import { formatDate, formatDwell, formatMoney } from "@/lib/format";
import {
  actionEmailHtml,
  actionEmailPreview,
  actionEmailSubject,
  actionEmailText,
  summarizeLines,
  type ActionEmailItem,
} from "@/lib/email/templates";

// The chase — docs/architecture.md#action-items--reminders. Takes
// db/sender/baseUrl as params rather than importing the app's singletons
// directly, so this runs identically from the Next.js app (the `Chase all N`
// button, a future scheduler webhook), a standalone script
// (scripts/send-reminders.ts), or a test with an injected fake sender and a
// test database.

/**
 * How long an item is left alone after being chased.
 *
 * Enforced server-side, in the query, not in the UI. `Chase all N` aggregates
 * by recipient and is one click; without a cooldown, two people on the buying
 * team clicking it in the same afternoon send a supplier the same request
 * twice. The failure mode this guards against isn't annoyance — it's the
 * supplier filtering our domain, which silently ends every chase we will ever
 * send them.
 */
export const CHASE_COOLDOWN_HOURS = 24;

export async function runReminderJob(params: {
  db: PrismaClient;
  sender: EmailSender;
  baseUrl: string;
  /** Limit to one tenant — what the `Chase all N` button uses. */
  tenantId?: string;
  /** Only chase what the supplier side owes. */
  externalOnly?: boolean;
  now?: Date;
}): Promise<{ internalEmailsSent: number; externalEmailsSent: number; skippedByCooldown: number }> {
  const { db, sender, baseUrl, tenantId, externalOnly } = params;
  const now = params.now ?? new Date();
  const cooldownBefore = new Date(now.getTime() - CHASE_COOLDOWN_HOURS * 3_600_000);

  const allOpen = await db.actionItem.findMany({
    where: {
      status: "OPEN",
      ...(tenantId ? { tenantId } : {}),
      ...(externalOnly ? { ownerType: "EXTERNAL_USER" } : {}),
    },
    include: {
      tenant: true,
      internalOwner: true,
      externalOwner: { include: { supplier: true } },
    },
    orderBy: { openedAt: "asc" },
  });

  const dueItems = allOpen.filter(
    (item) => item.lastRemindedAt == null || item.lastRemindedAt < cooldownBefore
  );
  const skippedByCooldown = allOpen.length - dueItems.length;

  const internalGroups = new Map<string, typeof dueItems>();
  const externalGroups = new Map<string, typeof dueItems>();

  for (const item of dueItems) {
    if (item.ownerType === "INTERNAL_USER" && item.internalOwnerId) {
      // The mirror of the inactive-contact skip below. A digest addressed to
      // somebody who has left is how a chase silently stops working while the
      // board keeps looking fine to everyone still here — and after Phase 3 a
      // directory can deactivate somebody at any hour with nobody on this side
      // watching.
      //
      // Skipped, never reassigned. This job runs per-tenant from the
      // `Chase all N` button, and a chase click must not silently rewrite who
      // owns what. Handing the work over belongs to deactivation itself
      // (src/lib/offboarding.ts), where somebody can see it happen.
      if (item.internalOwner?.status === "DEACTIVATED") continue;
      const group = internalGroups.get(item.internalOwnerId) ?? [];
      group.push(item);
      internalGroups.set(item.internalOwnerId, group);
    } else if (item.ownerType === "EXTERNAL_USER" && item.externalOwnerId) {
      // Inactive contacts are skipped, not chased. A reminder addressed to
      // someone who left the supplier is how a chase silently stops working
      // while the board keeps looking fine to everyone on our side.
      if (item.externalOwner?.status === "INACTIVE") continue;
      const group = externalGroups.get(item.externalOwnerId) ?? [];
      group.push(item);
      externalGroups.set(item.externalOwnerId, group);
    }
  }

  // One lookup for every subject referenced across every group, rather than
  // per item — this job runs over an entire tenant.
  const context = await loadSubjectContext(db, dueItems);
  const remindedIds: string[] = [];

  let internalEmailsSent = 0;
  for (const items of internalGroups.values()) {
    const owner = items[0].internalOwner;
    if (!owner) continue;
    const lines = items.map((i) => {
      const subject = context.get(i.subjectId);
      const label = ACTION_COPY[i.actionType]?.label ?? i.actionType;
      const doc = subject?.documentNumber ? `${subject.documentNumber}  ` : "";
      const waiting = formatDwell(i.openedAt, now);
      return `- ${doc}${label} — waiting ${waiting}`;
    });
    await sender.send({
      to: owner.email,
      subject: `${items.length} open item${items.length === 1 ? "" : "s"} on your board`,
      previewText: "Oldest first. Everything here is yours to move.",
      text: `${lines.join("\n")}\n\nYour board: ${baseUrl}/dashboard`,
      fromName: `${items[0].tenant.name} via ZenoSource`,
    });
    internalEmailsSent++;
    remindedIds.push(...items.map((i) => i.id));
  }

  let externalEmailsSent = 0;
  for (const items of externalGroups.values()) {
    const owner = items[0].externalOwner;
    if (!owner) continue;
    const tenant = items[0].tenant;

    const buyer = await db.internalUser.findFirst({
      where: { tenantId: tenant.id, role: "OWNER", status: "ACTIVE" },
      select: { name: true, email: true },
      orderBy: { createdAt: "asc" },
    });

    const emailParams = {
      tenantName: tenant.name,
      contactName: owner.name,
      buyerName: buyer?.name ?? null,
      buyerEmail: buyer?.email ?? null,
      baseUrl,
      items: items.map((i): ActionEmailItem => {
        const subject = context.get(i.subjectId);
        return {
          actionType: i.actionType,
          accessToken: i.accessToken,
          documentNumber: subject?.documentNumber ?? null,
          lineSummary: subject?.lineSummary ?? null,
          needByDate: subject?.needByDate ?? null,
          value: subject?.value ?? null,
          lineCount: subject?.lineCount ?? 0,
        };
      }),
    };

    await sender.send({
      to: owner.email,
      subject: actionEmailSubject(emailParams),
      previewText: actionEmailPreview(emailParams),
      text: actionEmailText(emailParams),
      html: actionEmailHtml(emailParams),
      fromName: `${tenant.name} via ZenoSource`,
      replyTo: buyer?.email,
      // Deliberately absent: how many times this supplier has been chased.
      // It's on the buyer's screen, where it's a management fact, and never
      // in the email, where it would discipline the side whose goodwill we
      // need in November.
    });
    externalEmailsSent++;
    remindedIds.push(...items.map((i) => i.id));
  }

  if (remindedIds.length > 0) {
    await db.actionItem.updateMany({
      where: { id: { in: remindedIds } },
      data: { lastRemindedAt: now, reminderCount: { increment: 1 } },
    });
  }

  return { internalEmailsSent, externalEmailsSent, skippedByCooldown };
}

type SubjectContext = {
  documentNumber: string | null;
  lineSummary: string | null;
  needByDate: Date | null;
  value: number | null;
  lineCount: number;
};

async function loadSubjectContext(
  db: PrismaClient,
  items: { subjectType: string; subjectId: string }[]
): Promise<Map<string, SubjectContext>> {
  const context = new Map<string, SubjectContext>();

  const poIds = items.filter((i) => i.subjectType === "PURCHASE_ORDER").map((i) => i.subjectId);
  const lineIds = items
    .filter((i) => i.subjectType === "PURCHASE_ORDER_LINE")
    .map((i) => i.subjectId);
  const rfqIds = items.filter((i) => i.subjectType === "RFQ").map((i) => i.subjectId);

  if (poIds.length) {
    const pos = await db.purchaseOrder.findMany({
      where: { id: { in: poIds } },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    for (const po of pos) {
      context.set(po.id, {
        documentNumber: po.number,
        lineSummary: summarizeLines(po.lines),
        needByDate:
          po.lines
            .map((l) => l.needByDate)
            .filter((d): d is Date => d != null)
            .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
        value: Number(po.totalValue),
        lineCount: po.lines.length,
      });
    }
  }

  if (lineIds.length) {
    const lines = await db.purchaseOrderLine.findMany({
      where: { id: { in: lineIds } },
      include: { purchaseOrder: { select: { number: true } } },
    });
    for (const line of lines) {
      context.set(line.id, {
        documentNumber: line.purchaseOrder.number,
        lineSummary: summarizeLines([line]),
        needByDate: line.needByDate,
        value: Number(line.quantity) * Number(line.unitPrice),
        lineCount: 1,
      });
    }
  }

  if (rfqIds.length) {
    const rfqs = await db.rFQ.findMany({
      where: { id: { in: rfqIds } },
      include: { lines: true },
    });
    for (const rfq of rfqs) {
      context.set(rfq.id, {
        documentNumber: rfq.number,
        lineSummary: summarizeLines(rfq.lines),
        needByDate: rfq.quoteDeadline,
        value: null,
        lineCount: rfq.lines.length,
      });
    }
  }

  return context;
}

/**
 * A one-line summary of the chase for the buyer's own screen — the receipt
 * the `Chase all N` button hands back.
 */
export function describeChaseResult(result: {
  externalEmailsSent: number;
  skippedByCooldown: number;
}): string {
  if (result.externalEmailsSent === 0 && result.skippedByCooldown === 0) {
    return "Nothing to chase — nobody owes you anything right now.";
  }
  if (result.externalEmailsSent === 0) {
    return `Everyone outstanding was already chased in the last ${CHASE_COOLDOWN_HOURS} hours. Give them the day.`;
  }
  const suffix =
    result.skippedByCooldown > 0
      ? ` ${result.skippedByCooldown} skipped — chased within the last ${CHASE_COOLDOWN_HOURS} hours.`
      : "";
  return `Chased ${result.externalEmailsSent} supplier${result.externalEmailsSent === 1 ? "" : "s"}.${suffix}`;
}

/** Re-exported for the reports surface, which shows aging alongside value. */
export { formatDate, formatMoney };
