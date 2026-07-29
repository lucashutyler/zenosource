"use server";

import * as z from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentInternalUser } from "@/lib/dal";
import {
  createActionItem,
  resolveOpenActionItemsFor,
  tryResolveActionItem,
} from "@/lib/action-items";
import { allLocationsBelongToTenant, locationScopeFor, hasLocationAccess } from "@/lib/access";
import { allocateDocumentNumber, DOCUMENT_CLASS } from "@/lib/document-number";
import { recordStatusChange } from "@/lib/status-events";
import { parseDateInput } from "@/lib/format";
import { type FormState, fail, failWith } from "@/lib/form-state";
import { sendActionLink } from "@/lib/email/notify";

export type FormActionState = FormState;

const MAX_QUANTITY = 1_000_000;
const MAX_UNIT_PRICE = 10_000_000;

const LineInputSchema = z.object({
  itemNumber: z.string().trim().min(1, "Item number is required."),
  description: z.string().trim().min(1, "Description is required."),
  uom: z.string().trim().min(1, "Unit of measure is required."),
  quantity: z.coerce
    .number({ message: "Quantity must be a number." })
    .positive("Quantity must be more than zero.")
    .max(MAX_QUANTITY, `Quantity can't exceed ${MAX_QUANTITY.toLocaleString()}.`),
  locationId: z.string().trim().optional(),
  needByDate: z.string().trim().optional(),
});

type ParsedLine = z.infer<typeof LineInputSchema> & { needBy: Date | null };

/** Index-driven, uncapped — see the note on the PO parser for why. */
function parseLines(formData: FormData): {
  lines: ParsedLine[];
  fieldErrors: Record<string, string>;
} {
  const indices = [...formData.keys()]
    .map((key) => /^itemNumber-(\d+)$/.exec(key)?.[1])
    .filter((n): n is string => n != null)
    .map(Number)
    .sort((a, b) => a - b);

  const lines: ParsedLine[] = [];
  const fieldErrors: Record<string, string> = {};

  for (const i of indices) {
    const raw = {
      itemNumber: String(formData.get(`itemNumber-${i}`) ?? "").trim(),
      description: String(formData.get(`description-${i}`) ?? "").trim(),
      uom: String(formData.get(`uom-${i}`) ?? "").trim(),
      quantity: String(formData.get(`quantity-${i}`) ?? "").trim(),
      locationId: String(formData.get(`locationId-${i}`) ?? "").trim(),
      needByDate: String(formData.get(`needByDate-${i}`) ?? "").trim(),
    };
    // `uom` excluded — it's pre-filled on every row, so counting it would
    // turn spare blank rows into validation errors. See the PO parser.
    const meaningful = [
      raw.itemNumber,
      raw.description,
      raw.quantity,
      raw.locationId,
      raw.needByDate,
    ];
    if (!meaningful.some((v) => v !== "")) continue;

    const parsed = LineInputSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string") fieldErrors[`${field}-${i}`] ??= issue.message;
      }
      continue;
    }

    let needBy: Date | null = null;
    if (parsed.data.needByDate) {
      needBy = parseDateInput(parsed.data.needByDate);
      if (!needBy) {
        fieldErrors[`needByDate-${i}`] = "Use a real calendar date.";
        continue;
      }
    }
    lines.push({ ...parsed.data, needBy });
  }

  return { lines, fieldErrors };
}

function lineData(lines: ParsedLine[]) {
  return lines.map((l) => ({
    itemNumber: l.itemNumber,
    description: l.description,
    uom: l.uom,
    quantity: l.quantity,
    locationId: l.locationId || null,
    needByDate: l.needBy,
  }));
}

// --- Create ----------------------------------------------------------------

export async function createRFQ(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const { lines, fieldErrors } = parseLines(formData);
  if (Object.keys(fieldErrors).length > 0) return fail(formData, fieldErrors);
  if (lines.length === 0) {
    return failWith(formData, "Add at least one line — there's nothing to ask a supplier for.");
  }

  const deadlineRaw = String(formData.get("quoteDeadline") ?? "").trim();
  let quoteDeadline: Date | null = null;
  if (deadlineRaw) {
    quoteDeadline = parseDateInput(deadlineRaw);
    if (!quoteDeadline) {
      return fail(formData, { quoteDeadline: "Use a real calendar date." });
    }
  }

  const lineLocationIds = lines.map((l) => l.locationId).filter((v): v is string => !!v);
  if (!(await allLocationsBelongToTenant(lineLocationIds, user.tenantId))) {
    return failWith(formData, "One or more locations aren't valid for your organization.");
  }

  const scope = await locationScopeFor(user);
  if (scope) {
    const bad: Record<string, string> = {};
    lines.forEach((l, i) => {
      if (l.locationId && !scope.includes(l.locationId)) {
        bad[`locationId-${i}`] = "You aren't assigned to this location.";
      }
    });
    if (Object.keys(bad).length > 0) return fail(formData, bad);
  }

  // Only invite suppliers that actually belong to this tenant — never trust
  // checkbox values from the form directly.
  const requestedSupplierIds = [...new Set(formData.getAll("supplierIds").map(String))];
  const suppliers =
    requestedSupplierIds.length > 0
      ? await db.supplier.findMany({
          where: { id: { in: requestedSupplierIds }, tenantId: user.tenantId },
          include: { contacts: { where: { status: "ACTIVE" } } },
        })
      : [];

  // Inviting a supplier with no contact would create an invite nobody can
  // ever reach — no RFQ_SUBMIT_QUOTE item, no link, no way to respond, the
  // same non-terminal-and-unowned trap issuePurchaseOrder guards against.
  const contactless = suppliers.filter((s) => s.contacts.length === 0);
  if (contactless.length > 0) {
    return failWith(
      formData,
      `${contactless.map((s) => s.name).join(", ")} ${
        contactless.length === 1 ? "has" : "have"
      } no active contact on file — add one before inviting them to an RFQ.`
    );
  }

  const sending = suppliers.length > 0;

  const rfq = await db.$transaction(async (tx) => {
    const number = await allocateDocumentNumber(user.tenantId, DOCUMENT_CLASS.RFQ, tx);
    const created = await tx.rFQ.create({
      data: {
        tenantId: user.tenantId,
        number,
        // Inviting suppliers is effectively sending the RFQ; with none checked
        // it's just a draft.
        status: sending ? "SENT" : "DRAFT",
        quoteDeadline,
        lines: { create: lineData(lines) },
        invites: { create: suppliers.map((s) => ({ supplierId: s.id, status: "INVITED" })) },
      },
    });

    await recordStatusChange({
      tenantId: user.tenantId,
      subjectType: "RFQ",
      subjectId: created.id,
      fromStatus: null,
      toStatus: sending ? "SENT" : "DRAFT",
      actor: { type: "INTERNAL_USER", userId: user.id, label: user.name },
      note: sending ? `Sent to ${suppliers.map((s) => s.name).join(", ")}` : null,
      tx,
    });

    if (!sending) {
      // A draft RFQ is the buyer's own outstanding work.
      await createActionItem(
        {
          tenantId: user.tenantId,
          subjectType: "RFQ",
          subjectId: created.id,
          actionType: "RFQ_SEND_DRAFT",
          ownerType: "INTERNAL_USER",
          internalOwnerId: user.id,
        },
        tx
      );
    }

    return created;
  });

  // One RFQ_SUBMIT_QUOTE per invited supplier contact — closeRFQ and
  // awardRFQQuote already resolve every OPEN item on this RFQ's subject
  // (see resolveOpenActionItemsFor), so these compose without further
  // wiring once the RFQ is closed or awarded.
  for (const supplier of suppliers) {
    const item = await createActionItem({
      tenantId: user.tenantId,
      subjectType: "RFQ",
      subjectId: rfq.id,
      actionType: "RFQ_SUBMIT_QUOTE",
      ownerType: "EXTERNAL_USER",
      externalOwnerId: supplier.contacts[0].id,
    });
    await sendActionLink({ actionItemId: item.id });
  }

  revalidatePath("/dashboard/rfqs");
  revalidatePath("/dashboard");
  redirect(`/dashboard/rfqs/${rfq.id}`);
}

/**
 * Send a draft to its invited suppliers.
 *
 * A draft RFQ had no send action at all — the only way to get one out was to
 * tick the supplier boxes at creation time and never come back. Adding a
 * supplier later, or drafting today and sending tomorrow, were both
 * impossible.
 */
export async function sendRFQ(
  rfqId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const rfq = await db.rFQ.findFirst({
    where: { id: rfqId, tenantId: user.tenantId },
    include: {
      lines: true,
      invites: { include: { supplier: { include: { contacts: { where: { status: "ACTIVE" } } } } } },
    },
  });
  if (!rfq) return failWith(formData, "That RFQ no longer exists.");

  const scope = await locationScopeFor(user);
  if (!hasLocationAccess(rfq.lines.map((l) => l.locationId), scope)) {
    return failWith(formData, "You don't have access to this RFQ's locations.");
  }
  if (rfq.invites.length === 0) {
    return failWith(formData, "Invite at least one supplier before sending.");
  }

  const contactless = rfq.invites.filter((i) => i.supplier.contacts.length === 0);
  if (contactless.length > 0) {
    return failWith(
      formData,
      `${contactless.map((i) => i.supplier.name).join(", ")} ${
        contactless.length === 1 ? "has" : "have"
      } no active contact on file — add one before sending.`
    );
  }

  const result = await db.rFQ.updateMany({
    where: { id: rfqId, status: "DRAFT" },
    data: { status: "SENT" },
  });
  if (result.count === 0) return failWith(formData, "This RFQ has already been sent.");

  await recordStatusChange({
    tenantId: user.tenantId,
    subjectType: "RFQ",
    subjectId: rfqId,
    fromStatus: "DRAFT",
    toStatus: "SENT",
    actor: { type: "INTERNAL_USER", userId: user.id, label: user.name },
    note: `Sent to ${rfq.invites.map((i) => i.supplier.name).join(", ")}`,
  });

  await resolveOpenActionItemsFor("RFQ", rfqId, {
    actionType: "RFQ_SEND_DRAFT",
    resolvedBy: { internalUserId: user.id },
  });

  for (const invite of rfq.invites) {
    const item = await createActionItem({
      tenantId: user.tenantId,
      subjectType: "RFQ",
      subjectId: rfqId,
      actionType: "RFQ_SUBMIT_QUOTE",
      ownerType: "EXTERNAL_USER",
      externalOwnerId: invite.supplier.contacts[0].id,
    });
    await sendActionLink({ actionItemId: item.id });
  }

  revalidatePath(`/dashboard/rfqs/${rfqId}`);
  revalidatePath("/dashboard/rfqs");
  revalidatePath("/dashboard");
  return { ok: `Sent to ${rfq.invites.length} supplier${rfq.invites.length === 1 ? "" : "s"}.` };
}

export async function addRFQSupplier(
  rfqId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const rfq = await db.rFQ.findFirst({
    where: { id: rfqId, tenantId: user.tenantId },
    include: { lines: true },
  });
  if (!rfq) return failWith(formData, "That RFQ no longer exists.");
  if (rfq.status === "AWARDED" || rfq.status === "CLOSED") {
    return failWith(formData, "This RFQ is finished — you can't add suppliers to it.");
  }

  const scope = await locationScopeFor(user);
  if (!hasLocationAccess(rfq.lines.map((l) => l.locationId), scope)) {
    return failWith(formData, "You don't have access to this RFQ's locations.");
  }

  const supplierId = String(formData.get("supplierId") ?? "").trim();
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, tenantId: user.tenantId },
    include: { contacts: { where: { status: "ACTIVE" } } },
  });
  if (!supplier) return fail(formData, { supplierId: "Choose a supplier." });
  if (supplier.contacts.length === 0) {
    return fail(formData, {
      supplierId: `${supplier.name} has no active contact on file — add one first.`,
    });
  }

  const existing = await db.rFQSupplierInvite.findFirst({ where: { rfqId, supplierId } });
  if (existing) return fail(formData, { supplierId: `${supplier.name} is already invited.` });

  await db.rFQSupplierInvite.create({ data: { rfqId, supplierId, status: "INVITED" } });

  // Already out for quote? Then this supplier owes one from now.
  if (rfq.status !== "DRAFT") {
    const item = await createActionItem({
      tenantId: user.tenantId,
      subjectType: "RFQ",
      subjectId: rfqId,
      actionType: "RFQ_SUBMIT_QUOTE",
      ownerType: "EXTERNAL_USER",
      externalOwnerId: supplier.contacts[0].id,
    });
    await sendActionLink({ actionItemId: item.id });
  }

  revalidatePath(`/dashboard/rfqs/${rfqId}`);
  return { ok: `${supplier.name} invited.` };
}

export async function duplicateRFQ(rfqId: string) {
  const user = await getCurrentInternalUser();

  const source = await db.rFQ.findFirst({
    where: { id: rfqId, tenantId: user.tenantId },
    include: { lines: true, invites: true },
  });
  if (!source) return;

  const scope = await locationScopeFor(user);
  if (!hasLocationAccess(source.lines.map((l) => l.locationId), scope)) return;

  const copy = await db.$transaction(async (tx) => {
    const number = await allocateDocumentNumber(user.tenantId, DOCUMENT_CLASS.RFQ, tx);
    const created = await tx.rFQ.create({
      data: {
        tenantId: user.tenantId,
        number,
        status: "DRAFT",
        quoteDeadline: source.quoteDeadline,
        lines: {
          create: source.lines.map((l) => ({
            itemNumber: l.itemNumber,
            description: l.description,
            uom: l.uom,
            quantity: l.quantity,
            locationId: l.locationId,
            needByDate: l.needByDate,
          })),
        },
        // Carry the invited suppliers across. Dropping them produced a draft
        // that could never be sent — a copy of an RFQ with no one to ask is
        // not a copy of an RFQ.
        invites: {
          create: source.invites.map((i) => ({ supplierId: i.supplierId, status: "INVITED" })),
        },
      },
    });

    await recordStatusChange({
      tenantId: user.tenantId,
      subjectType: "RFQ",
      subjectId: created.id,
      fromStatus: null,
      toStatus: "DRAFT",
      actor: { type: "INTERNAL_USER", userId: user.id, label: user.name },
      note: `Duplicated from ${source.number}`,
      tx,
    });

    await createActionItem(
      {
        tenantId: user.tenantId,
        subjectType: "RFQ",
        subjectId: created.id,
        actionType: "RFQ_SEND_DRAFT",
        ownerType: "INTERNAL_USER",
        internalOwnerId: user.id,
      },
      tx
    );

    return created;
  });

  revalidatePath("/dashboard/rfqs");
  redirect(`/dashboard/rfqs/${copy.id}`);
}

export async function deleteDraftRFQ(rfqId: string) {
  const user = await getCurrentInternalUser();

  const rfq = await db.rFQ.findFirst({
    where: { id: rfqId, tenantId: user.tenantId, status: "DRAFT" },
    include: { lines: true },
  });
  if (!rfq) return;

  const scope = await locationScopeFor(user);
  if (!hasLocationAccess(rfq.lines.map((l) => l.locationId), scope)) return;

  await db.$transaction(async (tx) => {
    await tx.actionItem.deleteMany({ where: { subjectType: "RFQ", subjectId: rfqId } });
    await tx.statusEvent.deleteMany({ where: { subjectType: "RFQ", subjectId: rfqId } });
    await tx.rFQSupplierInvite.deleteMany({ where: { rfqId } });
    await tx.rFQLine.deleteMany({ where: { rfqId } });
    await tx.rFQ.delete({ where: { id: rfqId } });
  });

  revalidatePath("/dashboard/rfqs");
  revalidatePath("/dashboard");
  redirect("/dashboard/rfqs");
}

// Manual terminal exit for an RFQ that isn't going anywhere (no useful
// quotes, buyer changed their mind, etc). Atomic guard: only proceeds if the
// RFQ isn't already AWARDED or CLOSED, so a stale page can't re-close (a
// no-op) or clobber an award that landed in the meantime.
export async function closeRFQ(
  rfqId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const rfq = await db.rFQ.findFirst({
    where: { id: rfqId, tenantId: user.tenantId },
    include: { lines: true },
  });
  if (!rfq) return failWith(formData, "That RFQ no longer exists.");

  const scope = await locationScopeFor(user);
  if (!hasLocationAccess(rfq.lines.map((l) => l.locationId), scope)) {
    return failWith(formData, "You don't have access to this RFQ's locations.");
  }

  const result = await db.rFQ.updateMany({
    where: { id: rfqId, status: { notIn: ["CLOSED"] } },
    data: { status: "CLOSED" },
  });
  if (result.count === 0) return failWith(formData, "This RFQ is already closed.");

  await recordStatusChange({
    tenantId: user.tenantId,
    subjectType: "RFQ",
    subjectId: rfqId,
    fromStatus: rfq.status,
    toStatus: "CLOSED",
    actor: { type: "INTERNAL_USER", userId: user.id, label: user.name },
    note: String(formData.get("reason") ?? "").trim() || null,
  });

  // Closing without awarding makes any pending quote/award decision on this
  // RFQ moot — otherwise it sits in the inbox and daily reminders forever.
  await resolveOpenActionItemsFor("RFQ", rfqId, { resolvedBy: { internalUserId: user.id } });

  revalidatePath(`/dashboard/rfqs/${rfqId}`);
  revalidatePath("/dashboard/rfqs");
  revalidatePath("/dashboard");
  return undefined;
}

// Atomic guard: only the request that actually flips status away from
// AWARDED-eligible wins. If two buyers click Award on two different quotes
// for the same RFQ at once, only the first update's WHERE clause matches —
// the second gets count 0 and backs off instead of overwriting the award.
export async function awardRFQQuote(
  rfqId: string,
  quoteId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const rfq = await db.rFQ.findFirst({
    where: { id: rfqId, tenantId: user.tenantId },
    include: { lines: true, invites: { include: { supplier: true } } },
  });
  if (!rfq) return failWith(formData, "That RFQ no longer exists.");

  const scope = await locationScopeFor(user);
  if (!hasLocationAccess(rfq.lines.map((l) => l.locationId), scope)) {
    return failWith(formData, "You don't have access to this RFQ's locations.");
  }

  const quote = await db.rFQQuote.findFirst({
    where: { id: quoteId, rfqId: rfq.id, status: "SUBMITTED" },
    include: { supplier: true },
  });
  if (!quote) return failWith(formData, "That quote can't be awarded.");

  const result = await db.rFQ.updateMany({
    where: { id: rfqId, status: { notIn: ["AWARDED", "CLOSED"] } },
    data: { status: "AWARDED", awardedQuoteId: quoteId },
  });
  if (result.count === 0) {
    return failWith(formData, "This RFQ was already awarded or closed — someone beat you to it.");
  }

  await recordStatusChange({
    tenantId: user.tenantId,
    subjectType: "RFQ",
    subjectId: rfqId,
    fromStatus: rfq.status,
    toStatus: "AWARDED",
    actor: { type: "INTERNAL_USER", userId: user.id, label: user.name },
    note: `Awarded to ${quote.supplier.name}`,
  });

  await resolveOpenActionItemsFor("RFQ", rfqId, { resolvedBy: { internalUserId: user.id } });

  // Awarding does not create a purchase order (docs/data-model.md leaves that
  // as a deliberate buyer action). Without this item the winning quote goes
  // nowhere and nobody is reminded — the award becomes a status change with
  // no consequence, which is exactly the modeling bug.
  await createActionItem({
    tenantId: user.tenantId,
    subjectType: "RFQ",
    subjectId: rfqId,
    actionType: "RFQ_RAISE_PO_FROM_AWARD",
    ownerType: "INTERNAL_USER",
    internalOwnerId: user.id,
  });

  revalidatePath(`/dashboard/rfqs/${rfqId}`);
  revalidatePath("/dashboard/rfqs");
  revalidatePath("/dashboard");
  return undefined;
}

// --- External, token-authorized quote submission ---------------------------

/**
 * The largest single gap in the product before this.
 *
 * A supplier invited to an RFQ received a page headed "Submit your quote"
 * above a single **Acknowledge** button, which resolved the action item
 * having supplied no price, no lead time and no quote — the quote-comparison
 * surface therefore said "no quotes yet" forever, `RESPONSES_OPEN` was
 * unreachable through the app, and `RFQ_AWARD_DECISION` had no trigger to
 * hook into. Everything downstream of a supplier answering an RFQ was
 * unreachable from inside the product.
 */
export async function submitQuoteByToken(token: string, formData: FormData) {
  const item = await db.actionItem.findFirst({
    where: { accessToken: token, actionType: "RFQ_SUBMIT_QUOTE" },
    include: { externalOwner: { include: { supplier: true } } },
  });
  if (!item?.externalOwner) return { error: "This link isn't valid." };

  const supplierId = item.externalOwner.supplierId;
  const rfq = await db.rFQ.findFirst({
    where: { id: item.subjectId },
    include: { lines: { orderBy: { createdAt: "asc" } } },
  });
  if (!rfq) return { error: "This link isn't valid." };
  if (rfq.status === "AWARDED" || rfq.status === "CLOSED") {
    return { error: "This request for quote has already been decided." };
  }

  const declining = String(formData.get("intent") ?? "") === "decline";

  if (declining) {
    const resolved = await tryResolveActionItem(item.id, { contactId: item.externalOwnerId! });
    if (!resolved) return { error: "This item was already resolved — no further action needed." };

    await db.rFQSupplierInvite.updateMany({
      where: { rfqId: rfq.id, supplierId },
      data: { status: "DECLINED", declinedAt: new Date() },
    });
    return { error: undefined, declined: true };
  }

  // Per-line price and lead time. A line left blank is a no-bid, recorded as
  // an absent quote line rather than a zero — the award screen has to be able
  // to tell "didn't bid" from "bid nothing".
  const quoteLines: { rfqLineId: string; unitPrice: number; leadTimeDays: number; notes: string | null }[] =
    [];

  for (const line of rfq.lines) {
    const rawPrice = String(formData.get(`price-${line.id}`) ?? "").trim();
    const rawLead = String(formData.get(`lead-${line.id}`) ?? "").trim();
    if (!rawPrice && !rawLead) continue;
    if (!rawPrice) return { error: `Add a unit price for ${line.itemNumber}, or leave the line blank.` };

    const unitPrice = Number(rawPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > MAX_UNIT_PRICE) {
      return { error: `Check the unit price for ${line.itemNumber}.` };
    }
    const leadTimeDays = rawLead ? Number(rawLead) : 0;
    if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0 || leadTimeDays > 3650) {
      return { error: `Check the lead time for ${line.itemNumber}.` };
    }

    quoteLines.push({
      rfqLineId: line.id,
      unitPrice,
      leadTimeDays: Math.round(leadTimeDays),
      notes: String(formData.get(`notes-${line.id}`) ?? "").trim() || null,
    });
  }

  if (quoteLines.length === 0) {
    return { error: "Price at least one line, or decline the request." };
  }

  const resolved = await tryResolveActionItem(item.id, { contactId: item.externalOwnerId! });
  if (!resolved) return { error: "This item was already resolved — no further action needed." };

  await db.$transaction(async (tx) => {
    const quote = await tx.rFQQuote.upsert({
      where: { rfqId_supplierId: { rfqId: rfq.id, supplierId } },
      create: {
        rfqId: rfq.id,
        supplierId,
        status: "SUBMITTED",
        submittedAt: new Date(),
        lines: { create: quoteLines },
      },
      update: { status: "SUBMITTED", submittedAt: new Date() },
    });

    // Re-quoting replaces the previous figures rather than appending to them.
    await tx.rFQQuoteLine.deleteMany({
      where: { rfqQuoteId: quote.id, rfqLineId: { notIn: quoteLines.map((l) => l.rfqLineId) } },
    });
    for (const line of quoteLines) {
      await tx.rFQQuoteLine.upsert({
        where: { rfqQuoteId_rfqLineId: { rfqQuoteId: quote.id, rfqLineId: line.rfqLineId } },
        create: { rfqQuoteId: quote.id, ...line },
        update: { unitPrice: line.unitPrice, leadTimeDays: line.leadTimeDays, notes: line.notes },
      });
    }

    await tx.rFQSupplierInvite.updateMany({
      where: { rfqId: rfq.id, supplierId },
      data: { status: "RESPONDED", respondedAt: new Date() },
    });

    if (rfq.status === "SENT") {
      await tx.rFQ.update({ where: { id: rfq.id }, data: { status: "RESPONSES_OPEN" } });
      await recordStatusChange({
        tenantId: rfq.tenantId,
        subjectType: "RFQ",
        subjectId: rfq.id,
        fromStatus: "SENT",
        toStatus: "RESPONSES_OPEN",
        actor: {
          type: "EXTERNAL_USER",
          contactId: item.externalOwnerId,
          label: item.externalOwner!.name,
        },
        note: `First quote in, from ${item.externalOwner!.supplier.name}`,
        tx,
      });
    }
  });

  // The first quote in is what makes an award decision possible, so that's
  // when the buyer starts owing one.
  const existing = await db.actionItem.findFirst({
    where: {
      subjectType: "RFQ",
      subjectId: rfq.id,
      actionType: "RFQ_AWARD_DECISION",
      status: "OPEN",
    },
  });
  if (!existing) {
    const owner = await db.internalUser.findFirst({
      where: { tenantId: rfq.tenantId, role: "OWNER" },
    });
    if (owner) {
      await createActionItem({
        tenantId: rfq.tenantId,
        subjectType: "RFQ",
        subjectId: rfq.id,
        actionType: "RFQ_AWARD_DECISION",
        ownerType: "INTERNAL_USER",
        internalOwnerId: owner.id,
      });
    }
  }

  return { error: undefined, declined: false };
}
