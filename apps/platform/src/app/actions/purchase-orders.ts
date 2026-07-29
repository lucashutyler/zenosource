"use server";

import * as z from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentInternalUser } from "@/lib/dal";
import { locationScopeFor, pickInternalOwner, allLocationsBelongToTenant } from "@/lib/access";
import {
  createActionItem,
  resolveOpenActionItemsFor,
  tryResolveActionItem,
} from "@/lib/action-items";
import { allocateDocumentNumber, DOCUMENT_CLASS } from "@/lib/document-number";
import { recordStatusChange } from "@/lib/status-events";
import { refreshPurchaseOrderTotal, totalOf } from "@/lib/po-total";
import { parseDateInput } from "@/lib/format";
import { type FormState, fail, failWith } from "@/lib/form-state";
import { sendActionLink } from "@/lib/email/notify";
import { TERMINAL_LINE_STATUSES } from "@/lib/lifecycle";

export type FormActionState = FormState;

// --- Line parsing ----------------------------------------------------------

// Bounds, not just types. `z.coerce.number().positive()` accepted
// `1234567.8910` at `$9,876,543.2100` — a $12 trillion purchase order, which
// is in the seeded dev database right now because nothing stopped it. It also
// silently truncated precision past four decimals without telling anyone.
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
  unitPrice: z.coerce
    .number({ message: "Unit price must be a number." })
    .nonnegative("Unit price can't be negative.")
    .max(MAX_UNIT_PRICE, `Unit price can't exceed $${MAX_UNIT_PRICE.toLocaleString()}.`),
  locationId: z.string().trim().min(1, "Choose a location."),
  needByDate: z.string().trim().optional(),
});

type ParsedLine = z.infer<typeof LineInputSchema> & { needBy: Date | null };

/**
 * Read every line the form actually submitted.
 *
 * The old implementation looped `for (let i = 0; i < 5; i++)`. A sixth line
 * was discarded without a word, and editing a PO that already had more than
 * five lines would have dropped the tail on save. It also skipped any row
 * whose item number was blank — so a row with a quantity, a price and a date
 * but no part number vanished, taking the user's work with it and reporting
 * success.
 *
 * This drives off the form keys instead: any index present is a line, a row
 * that is entirely empty is genuinely empty, and a row with *some* data and a
 * missing item number is an error rather than a silent deletion.
 */
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
      unitPrice: String(formData.get(`unitPrice-${i}`) ?? "").trim(),
      locationId: String(formData.get(`locationId-${i}`) ?? "").trim(),
      needByDate: String(formData.get(`needByDate-${i}`) ?? "").trim(),
    };

    // Genuinely untouched row — skip it, don't complain about it.
    //
    // `uom` is deliberately excluded from this check: the form pre-fills it
    // with "EA" on every row, so counting it as user input would make three
    // blank spare rows into three validation errors the moment anyone
    // submitted a one-line order. A unit of measure on its own is never a
    // line; any of the other six fields means somebody started typing.
    const meaningful = [
      raw.itemNumber,
      raw.description,
      raw.quantity,
      raw.unitPrice,
      raw.locationId,
      raw.needByDate,
    ];
    if (!meaningful.some((v) => v !== "")) continue;

    const parsed = LineInputSchema.safeParse(raw);
    if (!parsed.success) {
      // One message per field, keyed by the control's own name, so it lands
      // under the input it's about. `Line 3: Invalid input` was the only
      // message this form could produce for any of seven fields.
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string") {
          fieldErrors[`${field}-${i}`] ??= issue.message;
        }
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

const SupplierSchema = z.object({
  supplierId: z.string().trim().min(1, "Choose a supplier."),
});

/** Shared validation for create and edit. */
async function validatePOInput(
  formData: FormData,
  user: { id: string; tenantId: string; role: string }
): Promise<
  | { ok: true; supplierId: string; lines: ParsedLine[] }
  | { ok: false; state: FormActionState }
> {
  const fieldErrors: Record<string, string> = {};

  const supplier = SupplierSchema.safeParse({ supplierId: formData.get("supplierId") });
  if (!supplier.success) {
    fieldErrors.supplierId = supplier.error.issues[0]?.message ?? "Choose a supplier.";
  }

  const { lines, fieldErrors: lineErrors } = parseLines(formData);
  Object.assign(fieldErrors, lineErrors);

  if (lines.length === 0 && Object.keys(lineErrors).length === 0) {
    return {
      ok: false,
      state: failWith(formData, "Add at least one line — a purchase order with nothing on it can't be issued."),
    };
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, state: fail(formData, fieldErrors) };
  }

  const supplierExists = await db.supplier.findFirst({
    where: { id: supplier.data!.supplierId, tenantId: user.tenantId },
    select: { id: true },
  });
  if (!supplierExists) {
    return { ok: false, state: fail(formData, { supplierId: "That supplier isn't on your account." }) };
  }

  const locationIds = lines.map((l) => l.locationId);
  if (!(await allLocationsBelongToTenant(locationIds, user.tenantId))) {
    return {
      ok: false,
      state: failWith(formData, "One or more locations aren't valid for your organization."),
    };
  }

  const scope = await locationScopeFor(user);
  if (scope) {
    const outOfScope = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !scope.includes(l.locationId));
    if (outOfScope.length > 0) {
      const errors: Record<string, string> = {};
      for (const { i } of outOfScope) {
        errors[`locationId-${i}`] = "You aren't assigned to this location.";
      }
      return { ok: false, state: fail(formData, errors) };
    }
  }

  return { ok: true, supplierId: supplier.data!.supplierId, lines };
}

function lineData(lines: ParsedLine[]) {
  return lines.map((l, i) => ({
    lineNumber: i + 1,
    itemNumber: l.itemNumber,
    description: l.description,
    uom: l.uom,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    locationId: l.locationId,
    needByDate: l.needBy,
  }));
}

// --- Create / edit ---------------------------------------------------------

export async function createPurchaseOrder(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  const validated = await validatePOInput(formData, user);
  if (!validated.ok) return validated.state;

  const po = await db.$transaction(async (tx) => {
    const number = await allocateDocumentNumber(
      user.tenantId,
      DOCUMENT_CLASS.PURCHASE_ORDER,
      tx
    );
    const created = await tx.purchaseOrder.create({
      data: {
        tenantId: user.tenantId,
        number,
        supplierId: validated.supplierId,
        status: "DRAFT",
        totalValue: totalOf(validated.lines),
        lines: { create: lineData(validated.lines) },
      },
    });

    await recordStatusChange({
      tenantId: user.tenantId,
      subjectType: "PURCHASE_ORDER",
      subjectId: created.id,
      fromStatus: null,
      toStatus: "DRAFT",
      actor: { type: "INTERNAL_USER", userId: user.id, label: user.name },
      tx,
    });

    // A draft is work sitting still, owned by whoever started it. Without
    // this, a PO created and forgotten is invisible to the chase — which is
    // the modeling bug docs/product.md names, in the very first state.
    await createActionItem(
      {
        tenantId: user.tenantId,
        subjectType: "PURCHASE_ORDER",
        subjectId: created.id,
        actionType: "PO_ISSUE_DRAFT",
        ownerType: "INTERNAL_USER",
        internalOwnerId: user.id,
      },
      tx
    );

    return created;
  });

  revalidatePath("/dashboard/purchase-orders");
  revalidatePath("/dashboard");
  redirect(`/dashboard/purchase-orders/${po.id}`);
}

export async function updateDraftPurchaseOrder(
  poId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const po = await db.purchaseOrder.findFirst({
    where: { id: poId, tenantId: user.tenantId },
    select: { id: true, status: true },
  });
  if (!po) return failWith(formData, "That purchase order no longer exists.");
  if (po.status !== "DRAFT") {
    return failWith(
      formData,
      "This PO is already with the supplier. Issued POs change by agreement, not by edit — propose a change or cancel and reissue."
    );
  }

  const validated = await validatePOInput(formData, user);
  if (!validated.ok) return validated.state;

  await db.$transaction(async (tx) => {
    await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: poId } });
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        supplierId: validated.supplierId,
        totalValue: totalOf(validated.lines),
        lines: { create: lineData(validated.lines) },
      },
    });
  });

  revalidatePath(`/dashboard/purchase-orders/${poId}`);
  redirect(`/dashboard/purchase-orders/${poId}`);
}

export async function duplicatePurchaseOrder(poId: string) {
  const user = await getCurrentInternalUser();

  const source = await db.purchaseOrder.findFirst({
    where: { id: poId, tenantId: user.tenantId },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  if (!source) return;

  const copy = await db.$transaction(async (tx) => {
    const number = await allocateDocumentNumber(
      user.tenantId,
      DOCUMENT_CLASS.PURCHASE_ORDER,
      tx
    );
    const created = await tx.purchaseOrder.create({
      data: {
        tenantId: user.tenantId,
        number,
        supplierId: source.supplierId,
        status: "DRAFT",
        totalValue: source.totalValue,
        lines: {
          create: source.lines.map((l) => ({
            lineNumber: l.lineNumber,
            itemNumber: l.itemNumber,
            description: l.description,
            uom: l.uom,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            locationId: l.locationId,
            needByDate: l.needByDate,
          })),
        },
      },
    });

    await recordStatusChange({
      tenantId: user.tenantId,
      subjectType: "PURCHASE_ORDER",
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
        subjectType: "PURCHASE_ORDER",
        subjectId: created.id,
        actionType: "PO_ISSUE_DRAFT",
        ownerType: "INTERNAL_USER",
        internalOwnerId: user.id,
      },
      tx
    );

    return created;
  });

  revalidatePath("/dashboard/purchase-orders");
  redirect(`/dashboard/purchase-orders/${copy.id}`);
}

/**
 * Delete a draft outright.
 *
 * Without this the only exit from a mistaken draft was cancelling it, which
 * left it in the list permanently wearing a CANCELLED badge — a tombstone for
 * a document that never existed. Only drafts: anything issued has been seen
 * by a supplier and has to keep its history.
 */
export async function deleteDraftPurchaseOrder(poId: string) {
  const user = await getCurrentInternalUser();

  const po = await db.purchaseOrder.findFirst({
    where: { id: poId, tenantId: user.tenantId },
    select: { id: true, status: true },
  });
  if (!po || po.status !== "DRAFT") return;

  await db.$transaction(async (tx) => {
    // Guarded delete: only if it's *still* a draft at write time.
    const deleted = await tx.purchaseOrder.updateMany({
      where: { id: poId, status: "DRAFT" },
      data: { status: "DRAFT" },
    });
    if (deleted.count === 0) return;

    await tx.actionItem.deleteMany({
      where: { subjectType: "PURCHASE_ORDER", subjectId: poId },
    });
    await tx.statusEvent.deleteMany({
      where: { subjectType: "PURCHASE_ORDER", subjectId: poId },
    });
    await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: poId } });
    await tx.purchaseOrder.delete({ where: { id: poId } });
  });

  revalidatePath("/dashboard/purchase-orders");
  revalidatePath("/dashboard");
  redirect("/dashboard/purchase-orders");
}

// --- Issue -----------------------------------------------------------------

export async function issuePurchaseOrder(
  poId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const po = await db.purchaseOrder.findFirst({
    where: { id: poId, tenantId: user.tenantId },
    include: {
      supplier: { include: { contacts: { where: { status: "ACTIVE" } } } },
      lines: { orderBy: { lineNumber: "asc" } },
    },
  });
  if (!po) return failWith(formData, "That purchase order no longer exists.");

  // Block rather than silently issuing into the void: an ISSUED PO with no
  // contact to acknowledge it would carry no PO_ACKNOWLEDGE item and no
  // link for a supplier to ever act on — a non-terminal status nobody is
  // reminded about, exactly the modeling bug the product philosophy rules
  // out. Add a contact to the supplier first.
  if (po.supplier.contacts.length === 0) {
    return failWith(
      formData,
      `${po.supplier.name} has no active contact on file — add one before issuing this PO.`
    );
  }

  // Let the buyer pick the recipient rather than always using contacts[0].
  const requestedContactId = String(formData.get("contactId") ?? "").trim();
  const contact =
    po.supplier.contacts.find((c) => c.id === requestedContactId) ?? po.supplier.contacts[0];

  // Atomic guard: only proceed if this request is the one that actually
  // flips DRAFT -> ISSUED. A second concurrent click (or another team
  // member with access to the same PO) gets count 0 and stops here rather
  // than re-issuing or double-creating the acknowledgment action item.
  const result = await db.purchaseOrder.updateMany({
    where: { id: poId, status: "DRAFT" },
    data: { status: "ISSUED" },
  });
  if (result.count === 0) {
    return failWith(formData, "This PO already changed — someone beat you to it.");
  }

  await recordStatusChange({
    tenantId: user.tenantId,
    subjectType: "PURCHASE_ORDER",
    subjectId: po.id,
    fromStatus: "DRAFT",
    toStatus: "ISSUED",
    actor: { type: "INTERNAL_USER", userId: user.id, label: user.name },
    note: `Sent to ${contact.name} <${contact.email}>`,
  });

  await resolveOpenActionItemsFor("PURCHASE_ORDER", po.id, {
    actionType: "PO_ISSUE_DRAFT",
    resolvedBy: { internalUserId: user.id },
  });

  const item = await createActionItem({
    tenantId: user.tenantId,
    subjectType: "PURCHASE_ORDER",
    subjectId: po.id,
    actionType: "PO_ACKNOWLEDGE",
    ownerType: "EXTERNAL_USER",
    externalOwnerId: contact.id,
  });

  // Send the link now, not at the next digest. Issuing a PO used to send the
  // supplier nothing at all — the only email producer in the app was the
  // daily job, so the supplier learned about an order up to 24 hours after it
  // was placed, if at all.
  await sendActionLink({ actionItemId: item.id });

  revalidatePath(`/dashboard/purchase-orders/${poId}`);
  revalidatePath("/dashboard/purchase-orders");
  revalidatePath("/dashboard");
  return { ok: `Sent to ${contact.name}.` };
}

// --- Cancel ----------------------------------------------------------------

const CancelSchema = z.object({
  reason: z.string().trim().optional(),
});

export async function cancelPurchaseOrder(
  poId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const po = await db.purchaseOrder.findFirst({
    where: { id: poId, tenantId: user.tenantId },
    include: { lines: { select: { id: true } } },
  });
  if (!po) return failWith(formData, "That purchase order no longer exists.");

  const parsed = CancelSchema.safeParse({ reason: formData.get("reason") });
  const reason = parsed.success ? parsed.data.reason || null : null;

  // Atomic guard: the where-clause re-checks the non-terminal condition at
  // write time, not just at the earlier read. If someone else already
  // cancelled (or the PO reached FULFILLED/CLOSED) between our read and
  // this write, count is 0 and we report that instead of overwriting it.
  const result = await db.purchaseOrder.updateMany({
    where: { id: poId, status: { notIn: ["FULFILLED", "CLOSED", "CANCELLED"] } },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledByUserId: user.id,
      cancellationReason: reason,
    },
  });
  if (result.count === 0) {
    return failWith(formData, "This PO was already cancelled or completed — someone beat you to it.");
  }

  await db.purchaseOrderLine.updateMany({
    where: { purchaseOrderId: poId, status: { notIn: TERMINAL_LINE_STATUSES } },
    data: { status: "CANCELLED" },
  });

  await recordStatusChange({
    tenantId: user.tenantId,
    subjectType: "PURCHASE_ORDER",
    subjectId: poId,
    fromStatus: po.status,
    toStatus: "CANCELLED",
    actor: { type: "INTERNAL_USER", userId: user.id, label: user.name },
    note: reason,
  });

  // Cancelling makes any pending review on the PO *or any of its lines*
  // moot — a line-level item (e.g. a supplier's proposed change) left OPEN
  // here would sit in the inbox and daily reminders forever, pointing at a
  // cancelled PO nobody can act on anymore.
  await resolveOpenActionItemsFor("PURCHASE_ORDER", poId, {
    resolvedBy: { internalUserId: user.id },
  });
  await resolveOpenActionItemsFor(
    "PURCHASE_ORDER_LINE",
    po.lines.map((l) => l.id),
    { resolvedBy: { internalUserId: user.id } }
  );

  revalidatePath(`/dashboard/purchase-orders/${poId}`);
  revalidatePath("/dashboard/purchase-orders");
  revalidatePath("/dashboard");
  return undefined;
}

// --- Receipt and close -----------------------------------------------------

/**
 * Record what actually turned up.
 *
 * `IN_PROGRESS`, `FULFILLED` and `CLOSED` were reachable only by seeding the
 * database — there was no path through the app to any of them, so an
 * acknowledged PO sat in ACKNOWLEDGED forever offering no action but
 * Duplicate. Receipt is per line, because partial deliveries are the normal
 * case in this market, and the header rolls up from the lines rather than
 * being set independently.
 */
export async function receivePurchaseOrderLines(
  poId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const po = await db.purchaseOrder.findFirst({
    where: { id: poId, tenantId: user.tenantId },
    include: { lines: { orderBy: { lineNumber: "asc" } }, supplier: true },
  });
  if (!po) return failWith(formData, "That purchase order no longer exists.");
  if (!["ACKNOWLEDGED", "IN_PROGRESS", "ISSUED"].includes(po.status)) {
    return failWith(formData, `A ${po.status.toLowerCase()} order can't take a receipt.`);
  }

  const receivedAt = parseDateInput(formData.get("receivedAt")) ?? new Date();
  const fieldErrors: Record<string, string> = {};
  const updates: { id: string; quantity: number }[] = [];

  for (const line of po.lines) {
    if (TERMINAL_LINE_STATUSES.includes(line.status)) continue;
    const raw = String(formData.get(`received-${line.id}`) ?? "").trim();
    if (raw === "") continue;
    const quantity = Number(raw);
    if (!Number.isFinite(quantity) || quantity < 0) {
      fieldErrors[`received-${line.id}`] = "Enter a quantity of zero or more.";
      continue;
    }
    if (quantity > Number(line.quantity) * 1.5) {
      // Over-receipt happens and is legitimate; 50% over is a typo.
      fieldErrors[`received-${line.id}`] =
        `That's more than 1.5x the ordered ${Number(line.quantity)} ${line.uom} — check the figure.`;
      continue;
    }
    updates.push({ id: line.id, quantity });
  }

  if (Object.keys(fieldErrors).length > 0) return fail(formData, fieldErrors);
  if (updates.length === 0) {
    return failWith(formData, "Enter a received quantity on at least one line.");
  }

  await db.$transaction(async (tx) => {
    for (const update of updates) {
      const line = po.lines.find((l) => l.id === update.id)!;
      const alreadyReceived = Number(line.receivedQuantity ?? 0);
      const total = alreadyReceived + update.quantity;
      const complete = total >= Number(line.quantity);
      await tx.purchaseOrderLine.update({
        where: { id: update.id },
        data: {
          receivedQuantity: total,
          receivedAt,
          status: complete ? "FULFILLED" : "PARTIALLY_RECEIVED",
        },
      });
    }

    const lines = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: poId },
      select: { status: true },
    });
    const active = lines.filter((l) => l.status !== "CANCELLED");
    const allDone = active.length > 0 && active.every((l) => l.status === "FULFILLED");
    const anyDone = active.some(
      (l) => l.status === "FULFILLED" || l.status === "PARTIALLY_RECEIVED"
    );
    const nextStatus = allDone ? "FULFILLED" : anyDone ? "IN_PROGRESS" : po.status;

    if (nextStatus !== po.status) {
      await tx.purchaseOrder.update({ where: { id: poId }, data: { status: nextStatus } });
      await recordStatusChange({
        tenantId: user.tenantId,
        subjectType: "PURCHASE_ORDER",
        subjectId: poId,
        fromStatus: po.status,
        toStatus: nextStatus,
        actor: { type: "INTERNAL_USER", userId: user.id, label: user.name },
        occurredAt: receivedAt,
        tx,
      });
    }

    if (allDone) {
      // The supplier's obligation is discharged; ours begins.
      await resolveOpenActionItemsFor("PURCHASE_ORDER", poId, {
        actionType: ["PO_DELIVER", "PO_ACKNOWLEDGE"],
        resolvedBy: { internalUserId: user.id },
        tx,
      });
      await createActionItem(
        {
          tenantId: user.tenantId,
          subjectType: "PURCHASE_ORDER",
          subjectId: poId,
          actionType: "PO_CLOSE",
          ownerType: "INTERNAL_USER",
          internalOwnerId: user.id,
        },
        tx
      );
    }
  });

  revalidatePath(`/dashboard/purchase-orders/${poId}`);
  revalidatePath("/dashboard/purchase-orders");
  revalidatePath("/dashboard");
  return { ok: "Receipt recorded." };
}

export async function closePurchaseOrder(
  poId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const po = await db.purchaseOrder.findFirst({
    where: { id: poId, tenantId: user.tenantId },
    select: { id: true, status: true },
  });
  if (!po) return failWith(formData, "That purchase order no longer exists.");

  const result = await db.purchaseOrder.updateMany({
    where: { id: poId, status: "FULFILLED" },
    data: { status: "CLOSED" },
  });
  if (result.count === 0) {
    return failWith(formData, "Only a fully received order can be closed.");
  }

  await db.purchaseOrderLine.updateMany({
    where: { purchaseOrderId: poId, status: "FULFILLED" },
    data: { status: "CLOSED" },
  });

  await recordStatusChange({
    tenantId: user.tenantId,
    subjectType: "PURCHASE_ORDER",
    subjectId: poId,
    fromStatus: "FULFILLED",
    toStatus: "CLOSED",
    actor: { type: "INTERNAL_USER", userId: user.id, label: user.name },
  });

  await resolveOpenActionItemsFor("PURCHASE_ORDER", poId, {
    resolvedBy: { internalUserId: user.id },
  });

  revalidatePath(`/dashboard/purchase-orders/${poId}`);
  revalidatePath("/dashboard/purchase-orders");
  revalidatePath("/dashboard");
  return undefined;
}

/**
 * Revise a rejected PO and send it back.
 *
 * The only exits from REJECTED were Cancel, or a Duplicate that produced an
 * unlinked new draft and left the review item open — so the buyer who did the
 * intended thing got reminded about the rejection forever. This makes the
 * revision an explicit successor: the rejection is resolved, the new draft
 * records where it came from, and the old PO is cancelled with a reason that
 * points at its replacement.
 */
export async function reviseRejectedPurchaseOrder(poId: string) {
  const user = await getCurrentInternalUser();

  const source = await db.purchaseOrder.findFirst({
    where: { id: poId, tenantId: user.tenantId, status: "REJECTED" },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  if (!source) return;

  const copy = await db.$transaction(async (tx) => {
    const number = await allocateDocumentNumber(
      user.tenantId,
      DOCUMENT_CLASS.PURCHASE_ORDER,
      tx
    );
    const created = await tx.purchaseOrder.create({
      data: {
        tenantId: user.tenantId,
        number,
        supplierId: source.supplierId,
        status: "DRAFT",
        totalValue: source.totalValue,
        lines: {
          create: source.lines.map((l) => ({
            lineNumber: l.lineNumber,
            itemNumber: l.itemNumber,
            description: l.description,
            uom: l.uom,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            locationId: l.locationId,
            needByDate: l.needByDate,
          })),
        },
      },
    });

    await recordStatusChange({
      tenantId: user.tenantId,
      subjectType: "PURCHASE_ORDER",
      subjectId: created.id,
      fromStatus: null,
      toStatus: "DRAFT",
      actor: { type: "INTERNAL_USER", userId: user.id, label: user.name },
      note: `Revision of ${source.number}, which the supplier rejected`,
      tx,
    });

    await tx.purchaseOrder.update({
      where: { id: source.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: user.id,
        cancellationReason: `Superseded by ${number}`,
      },
    });
    await tx.purchaseOrderLine.updateMany({
      where: { purchaseOrderId: source.id, status: { notIn: TERMINAL_LINE_STATUSES } },
      data: { status: "CANCELLED" },
    });
    await recordStatusChange({
      tenantId: user.tenantId,
      subjectType: "PURCHASE_ORDER",
      subjectId: source.id,
      fromStatus: "REJECTED",
      toStatus: "CANCELLED",
      actor: { type: "INTERNAL_USER", userId: user.id, label: user.name },
      note: `Superseded by ${number}`,
      tx,
    });

    await resolveOpenActionItemsFor("PURCHASE_ORDER", source.id, {
      resolvedBy: { internalUserId: user.id },
      tx,
    });
    await createActionItem(
      {
        tenantId: user.tenantId,
        subjectType: "PURCHASE_ORDER",
        subjectId: created.id,
        actionType: "PO_ISSUE_DRAFT",
        ownerType: "INTERNAL_USER",
        internalOwnerId: user.id,
      },
      tx
    );

    return created;
  });

  revalidatePath("/dashboard/purchase-orders");
  revalidatePath("/dashboard");
  redirect(`/dashboard/purchase-orders/${copy.id}/edit`);
}

// --- Change proposals ------------------------------------------------------
//
// Both accept/reject are visible to every team member with access to this
// PO (an OWNER sees all locations; a MEMBER assigned to this PO's location
// sees it too) — the line is assigned to nobody in particular, so two
// people could plausibly click Accept/Reject around the same time. The
// where-clause re-checks CHANGE_PROPOSED at write time so only the first
// write actually lands; the second gets count 0 and backs off instead of
// re-applying (or worse, re-nulling already-cleared proposed_* fields).

export async function acceptChangeProposal(lineId: string) {
  await decideChangeProposal(lineId, "ACCEPTED");
}

export async function rejectChangeProposal(lineId: string) {
  await decideChangeProposal(lineId, "REJECTED");
}

async function decideChangeProposal(lineId: string, outcome: "ACCEPTED" | "REJECTED") {
  const user = await getCurrentInternalUser();

  const line = await db.purchaseOrderLine.findFirst({
    where: { id: lineId, purchaseOrder: { tenantId: user.tenantId } },
    include: { purchaseOrder: { select: { id: true, tenantId: true, supplierId: true } } },
  });
  if (!line) return;

  const accepted = outcome === "ACCEPTED";

  const result = await db.purchaseOrderLine.updateMany({
    where: { id: lineId, status: "CHANGE_PROPOSED" },
    data: {
      ...(accepted
        ? {
            quantity: line.proposedQuantity ?? line.quantity,
            unitPrice: line.proposedUnitPrice ?? line.unitPrice,
            promiseDate: line.proposedDate ?? line.promiseDate,
          }
        : {}),
      proposedQuantity: null,
      proposedUnitPrice: null,
      proposedDate: null,
      proposedBySupplierContact: null,
      proposedAt: null,
      status: "ACKNOWLEDGED",
    },
  });
  if (result.count === 0) return;

  // Preserve the decision. Nulling the proposal in place used to destroy the
  // only evidence the exchange happened — and "change-proposal rate" and
  // "average date slip" are supplier-scorecard metrics that can't be
  // reconstructed after the fact.
  await db.pOLineChangeProposal.updateMany({
    where: { purchaseOrderLineId: lineId, outcome: "PENDING" },
    data: {
      outcome,
      decidedAt: new Date(),
      decidedByUserId: user.id,
    },
  });

  if (accepted) {
    await refreshPurchaseOrderTotal(line.purchaseOrderId);
  }

  await recordStatusChange({
    tenantId: user.tenantId,
    subjectType: "PURCHASE_ORDER_LINE",
    subjectId: lineId,
    fromStatus: "CHANGE_PROPOSED",
    toStatus: "ACKNOWLEDGED",
    actor: { type: "INTERNAL_USER", userId: user.id, label: user.name },
    note: accepted ? "Change accepted" : "Change rejected — original terms stand",
  });

  await resolveOpenActionItemsFor("PURCHASE_ORDER_LINE", lineId, {
    resolvedBy: { internalUserId: user.id },
  });

  // Tell the supplier what was decided. Accept/reject used to leave no trace
  // anywhere — not on the PO, and not with the person who asked.
  await notifySupplierOfDecision(line.purchaseOrderId, lineId, accepted);

  revalidatePath(`/dashboard/purchase-orders/${line.purchaseOrderId}`);
  revalidatePath("/dashboard");
}

async function notifySupplierOfDecision(poId: string, lineId: string, accepted: boolean) {
  const line = await db.purchaseOrderLine.findUnique({
    where: { id: lineId },
    include: {
      purchaseOrder: {
        include: {
          tenant: { select: { name: true } },
          supplier: { include: { contacts: { where: { status: "ACTIVE" }, take: 1 } } },
        },
      },
    },
  });
  const contact = line?.purchaseOrder.supplier.contacts[0];
  if (!line || !contact) return;

  const { sendPlainNotice } = await import("@/lib/email/notify");
  await sendPlainNotice({
    to: contact.email,
    tenantName: line.purchaseOrder.tenant.name,
    subject: `${line.purchaseOrder.tenant.name} ${accepted ? "accepted" : "declined"} your change to ${line.purchaseOrder.number}`,
    body: accepted
      ? `Your proposed change to line ${line.lineNumber} (${line.itemNumber}) on ${line.purchaseOrder.number} has been accepted. The order now reads ${Number(line.quantity)} ${line.uom} at $${Number(line.unitPrice)}.`
      : `Your proposed change to line ${line.lineNumber} (${line.itemNumber}) on ${line.purchaseOrder.number} was not accepted. The original terms stand: ${Number(line.quantity)} ${line.uom} at $${Number(line.unitPrice)}.`,
  });
}

// --- External, token-authorized actions (no session) ------------------------

export async function acknowledgePOByToken(token: string, formData?: FormData) {
  const item = await db.actionItem.findFirst({
    where: { accessToken: token, actionType: "PO_ACKNOWLEDGE" },
    include: { externalOwner: true },
  });
  if (!item) return { error: "This link isn't valid." };

  // Resolve the action item FIRST, atomically — this is the race guard.
  // The link is reopenable (see docs/architecture.md#action-items--reminders)
  // so it's easy to have it open in two tabs, or for the buyer to cancel the
  // PO in the same window the supplier is acknowledging it. Only whichever
  // request actually flips OPEN -> RESOLVED goes on to touch the PO.
  const resolved = await tryResolveActionItem(item.id, { contactId: item.externalOwnerId ?? undefined });
  if (!resolved) {
    return { error: "This item was already resolved — no further action needed." };
  }

  // Guarded like every internal transition: winning the action-item race
  // doesn't mean the PO is still ISSUED — the buyer could cancel it in the
  // same window. An unconditional update here would resurrect a CANCELLED
  // PO as ACKNOWLEDGED with its lines still CANCELLED.
  const result = await db.purchaseOrder.updateMany({
    where: { id: item.subjectId, status: "ISSUED" },
    data: { status: "ACKNOWLEDGED" },
  });
  if (result.count === 0) {
    return { error: "This purchase order changed before your response could be recorded." };
  }

  const lines = await db.purchaseOrderLine.findMany({
    where: { purchaseOrderId: item.subjectId, status: "PENDING_ACKNOWLEDGMENT" },
    select: { id: true, needByDate: true },
  });

  // Capture the promise date the acknowledgment implies.
  // docs/data-model.md says `promise_date` is "set once acknowledged" — the
  // form never asked, so the happy path left it null forever and every
  // on-time-delivery metric had nothing to measure against.
  for (const line of lines) {
    const promised = formData ? parseDateInput(formData.get(`promise-${line.id}`)) : null;
    await db.purchaseOrderLine.update({
      where: { id: line.id },
      data: { status: "ACKNOWLEDGED", promiseDate: promised ?? line.needByDate },
    });
  }

  const po = await db.purchaseOrder.findUnique({
    where: { id: item.subjectId },
    select: { tenantId: true, id: true },
  });
  if (po) {
    await recordStatusChange({
      tenantId: po.tenantId,
      subjectType: "PURCHASE_ORDER",
      subjectId: po.id,
      fromStatus: "ISSUED",
      toStatus: "ACKNOWLEDGED",
      actor: {
        type: "EXTERNAL_USER",
        contactId: item.externalOwnerId,
        label: item.externalOwner?.name ?? "Supplier",
      },
    });

    // The supplier's next obligation, opened at the moment the previous one
    // closes. Without this an ACKNOWLEDGED order sits with nobody being
    // chased right up until someone notices it never arrived.
    await createActionItem({
      tenantId: po.tenantId,
      subjectType: "PURCHASE_ORDER",
      subjectId: po.id,
      actionType: "PO_DELIVER",
      ownerType: "EXTERNAL_USER",
      externalOwnerId: item.externalOwnerId ?? undefined,
    });
  }

  return { error: undefined };
}

const RejectPOSchema = z.object({ reason: z.string().trim().optional() });

export async function rejectPOByToken(token: string, formData: FormData) {
  const item = await db.actionItem.findFirst({
    where: { accessToken: token, actionType: "PO_ACKNOWLEDGE" },
    include: { externalOwner: true },
  });
  if (!item) return { error: "This link isn't valid." };

  const resolved = await tryResolveActionItem(item.id, {
    contactId: item.externalOwnerId ?? undefined,
  });
  if (!resolved) {
    return { error: "This item was already resolved — no further action needed." };
  }

  const parsed = RejectPOSchema.safeParse({ reason: formData.get("reason") });
  const reason = parsed.success ? parsed.data.reason || null : null;

  // Same guard as acknowledge: only write REJECTED if the PO is still
  // ISSUED, so a concurrent buyer cancellation can't be overwritten.
  const result = await db.purchaseOrder.updateMany({
    where: { id: item.subjectId, status: "ISSUED" },
    data: { status: "REJECTED", rejectedAt: new Date(), rejectionReason: reason },
  });
  if (result.count === 0) {
    return { error: "This purchase order changed before your response could be recorded." };
  }

  const po = await db.purchaseOrder.findFirst({
    where: { id: item.subjectId },
    include: { lines: true },
  });
  if (!po) return { error: undefined };

  await recordStatusChange({
    tenantId: po.tenantId,
    subjectType: "PURCHASE_ORDER",
    subjectId: po.id,
    fromStatus: "ISSUED",
    toStatus: "REJECTED",
    actor: {
      type: "EXTERNAL_USER",
      contactId: item.externalOwnerId,
      label: item.externalOwner?.name ?? "Supplier",
    },
    note: reason,
  });

  const locationIds = [...new Set(po.lines.map((l) => l.locationId).filter((v): v is string => !!v))];
  const ownerId = await pickInternalOwner(po.tenantId, locationIds);
  if (ownerId) {
    await createActionItem({
      tenantId: po.tenantId,
      subjectType: "PURCHASE_ORDER",
      subjectId: po.id,
      actionType: "PO_REVIEW_REJECTION",
      ownerType: "INTERNAL_USER",
      internalOwnerId: ownerId,
    });
  }

  return { error: undefined };
}

/**
 * Supplier-side counter-proposal, per line.
 *
 * The `proposed*` columns and `PO_REVIEW_CHANGE_PROPOSAL` shipped in Phase 1,
 * and so did the buyer's accept/reject UI — but nothing could ever produce a
 * proposal, so the flagship collaboration feature (the one the product is
 * effectively named for) was half-built and unreachable. This is the missing
 * half.
 */
export async function proposeChangeByToken(token: string, formData: FormData) {
  const item = await db.actionItem.findFirst({
    where: { accessToken: token, actionType: "PO_ACKNOWLEDGE" },
    include: { externalOwner: true },
  });
  if (!item) return { error: "This link isn't valid." };

  const po = await db.purchaseOrder.findFirst({
    where: { id: item.subjectId },
    include: { lines: { orderBy: { lineNumber: "asc" } }, tenant: { select: { name: true } } },
  });
  if (!po) return { error: "This link isn't valid." };
  if (po.status !== "ISSUED") {
    return { error: "This purchase order changed before your response could be recorded." };
  }

  type Proposal = {
    lineId: string;
    quantity: number;
    unitPrice: number;
    date: Date | null;
    previous: { quantity: number; unitPrice: number; date: Date | null };
  };
  const proposals: Proposal[] = [];

  for (const line of po.lines) {
    const rawQty = String(formData.get(`proposed-quantity-${line.id}`) ?? "").trim();
    const rawPrice = String(formData.get(`proposed-price-${line.id}`) ?? "").trim();
    const rawDate = String(formData.get(`proposed-date-${line.id}`) ?? "").trim();
    if (!rawQty && !rawPrice && !rawDate) continue;

    const quantity = rawQty ? Number(rawQty) : Number(line.quantity);
    const unitPrice = rawPrice ? Number(rawPrice) : Number(line.unitPrice);
    const date = rawDate ? parseDateInput(rawDate) : (line.needByDate ?? null);

    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
      return { error: `Line ${line.lineNumber}: check the quantity.` };
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > MAX_UNIT_PRICE) {
      return { error: `Line ${line.lineNumber}: check the unit price.` };
    }

    const unchanged =
      quantity === Number(line.quantity) &&
      unitPrice === Number(line.unitPrice) &&
      date?.getTime() === line.needByDate?.getTime();
    if (unchanged) continue;

    proposals.push({
      lineId: line.id,
      quantity,
      unitPrice,
      date,
      previous: {
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        date: line.needByDate,
      },
    });
  }

  if (proposals.length === 0) {
    return { error: "Change at least one quantity, price or date, or confirm the order as it stands." };
  }

  const resolved = await tryResolveActionItem(item.id, {
    contactId: item.externalOwnerId ?? undefined,
  });
  if (!resolved) {
    return { error: "This item was already resolved — no further action needed." };
  }

  const proposerName = item.externalOwner?.name ?? "Supplier";

  await db.$transaction(async (tx) => {
    for (const proposal of proposals) {
      await tx.purchaseOrderLine.update({
        where: { id: proposal.lineId },
        data: {
          status: "CHANGE_PROPOSED",
          proposedQuantity: proposal.quantity,
          proposedUnitPrice: proposal.unitPrice,
          proposedDate: proposal.date,
          proposedBySupplierContact: proposerName,
          proposedAt: new Date(),
        },
      });
      await tx.pOLineChangeProposal.create({
        data: {
          purchaseOrderLineId: proposal.lineId,
          previousQuantity: proposal.previous.quantity,
          previousUnitPrice: proposal.previous.unitPrice,
          previousDate: proposal.previous.date,
          proposedQuantity: proposal.quantity,
          proposedUnitPrice: proposal.unitPrice,
          proposedDate: proposal.date,
          proposedByContactId: item.externalOwnerId,
          proposedByName: proposerName,
        },
      });
      await recordStatusChange({
        tenantId: po.tenantId,
        subjectType: "PURCHASE_ORDER_LINE",
        subjectId: proposal.lineId,
        fromStatus: "PENDING_ACKNOWLEDGMENT",
        toStatus: "CHANGE_PROPOSED",
        actor: {
          type: "EXTERNAL_USER",
          contactId: item.externalOwnerId,
          label: proposerName,
        },
        tx,
      });
    }

    // Untouched lines are accepted as issued.
    const changedIds = proposals.map((p) => p.lineId);
    await tx.purchaseOrderLine.updateMany({
      where: {
        purchaseOrderId: po.id,
        status: "PENDING_ACKNOWLEDGMENT",
        id: { notIn: changedIds },
      },
      data: { status: "ACKNOWLEDGED" },
    });
  });

  const locationIds = [...new Set(po.lines.map((l) => l.locationId).filter((v): v is string => !!v))];
  const ownerId = await pickInternalOwner(po.tenantId, locationIds);
  if (ownerId) {
    for (const proposal of proposals) {
      await createActionItem({
        tenantId: po.tenantId,
        subjectType: "PURCHASE_ORDER_LINE",
        subjectId: proposal.lineId,
        actionType: "PO_REVIEW_CHANGE_PROPOSAL",
        ownerType: "INTERNAL_USER",
        internalOwnerId: ownerId,
      });
    }
  }

  return { error: undefined, proposedCount: proposals.length };
}
