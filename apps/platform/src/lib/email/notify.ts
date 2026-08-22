import "server-only";
import { db } from "@/lib/db";
import { getEmailSender } from "@/lib/email/sender";
import {
  actionEmailHtml,
  actionEmailPreview,
  actionEmailSubject,
  actionEmailText,
  summarizeLines,
  type ActionEmailItem,
  type ActionEmailParams,
} from "@/lib/email/templates";

// Transactional sends — the moment something happens, not the next digest.
//
// Before this, the *only* email producer in the entire app was the daily
// reminder job. Issuing a purchase order sent the supplier nothing: they
// found out up to 24 hours later, from a digest, or not at all. For a product
// whose central claim is that open actions get chased, the first chase
// arriving a day late is the wrong first impression.

function baseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

/**
 * The buyer a reply should reach.
 *
 * Prefers whoever owns an internal action item on the same subject, falling
 * back to the tenant's OWNER. A `no-reply` address on this email would be the
 * single most expensive character saving in the product: the supplier's most
 * common response to any automated request is to reply to it in prose.
 */
async function replyToFor(tenantId: string): Promise<{ name: string; email: string } | null> {
  const owner = await db.internalUser.findFirst({
    where: { tenantId, role: "OWNER", status: "ACTIVE" },
    select: { name: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  return owner ?? null;
}

async function buildItem(actionItemId: string): Promise<{
  item: ActionEmailItem;
  tenantId: string;
  tenantName: string;
  toEmail: string;
  contactName: string;
} | null> {
  const record = await db.actionItem.findUnique({
    where: { id: actionItemId },
    include: { tenant: { select: { name: true } }, externalOwner: true },
  });
  if (!record || !record.externalOwner) return null;

  let documentNumber: string | null = null;
  let lineSummary: string | null = null;
  let needByDate: Date | null = null;
  let value: number | null = null;
  let lineCount = 0;

  if (record.subjectType === "PURCHASE_ORDER") {
    const po = await db.purchaseOrder.findUnique({
      where: { id: record.subjectId },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    if (po) {
      documentNumber = po.number;
      lineSummary = summarizeLines(po.lines);
      needByDate = po.lines.map((l) => l.needByDate).filter(Boolean).sort()[0] ?? null;
      value = Number(po.totalValue);
      lineCount = po.lines.length;
    }
  } else if (record.subjectType === "RFQ") {
    const rfq = await db.rFQ.findUnique({
      where: { id: record.subjectId },
      include: { lines: { orderBy: { createdAt: "asc" } } },
    });
    if (rfq) {
      documentNumber = rfq.number;
      lineSummary = summarizeLines(rfq.lines.map((l) => ({ ...l, uom: l.uom })));
      needByDate = rfq.quoteDeadline;
      lineCount = rfq.lines.length;
    }
  }

  return {
    item: {
      actionType: record.actionType,
      accessToken: record.accessToken,
      documentNumber,
      lineSummary,
      needByDate,
      value,
      lineCount,
    },
    tenantId: record.tenantId,
    tenantName: record.tenant.name,
    toEmail: record.externalOwner.email,
    contactName: record.externalOwner.name,
  };
}

/** Send one action item's link to its external owner, right now. */
export async function sendActionLink(params: { actionItemId: string }): Promise<void> {
  const built = await buildItem(params.actionItemId);
  if (!built) return;

  const buyer = await replyToFor(built.tenantId);
  const emailParams: ActionEmailParams = {
    tenantName: built.tenantName,
    contactName: built.contactName,
    buyerName: buyer?.name ?? null,
    buyerEmail: buyer?.email ?? null,
    items: [built.item],
    baseUrl: baseUrl(),
  };

  await getEmailSender(db).send({
    to: built.toEmail,
    subject: actionEmailSubject(emailParams),
    previewText: actionEmailPreview(emailParams),
    text: actionEmailText(emailParams),
    html: actionEmailHtml(emailParams),
    fromName: `${built.tenantName} via ZenoSource`,
    replyTo: buyer?.email,
  });

  await db.actionItem.update({
    where: { id: params.actionItemId },
    data: { lastRemindedAt: new Date(), reminderCount: { increment: 1 } },
  });
}

/**
 * A plain notice with no action attached — "your change was accepted",
 * "this order was cancelled". Still carries the buyer's name and a working
 * reply address, because a supplier reading it may well need to say something
 * back and there is nowhere else in the product for them to say it.
 */
export async function sendPlainNotice(params: {
  to: string;
  tenantName: string;
  subject: string;
  body: string;
  replyToEmail?: string;
}): Promise<void> {
  await getEmailSender(db).send({
    to: params.to,
    subject: params.subject,
    text: `${params.body}\n\nSent by ${params.tenantName} through ZenoSource.`,
    fromName: `${params.tenantName} via ZenoSource`,
    replyTo: params.replyToEmail,
  });
}
