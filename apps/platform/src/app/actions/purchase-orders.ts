"use server";

import * as z from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentInternalUser } from "@/lib/dal";
import { locationScopeFor, pickInternalOwner, allLocationsBelongToTenant } from "@/lib/access";
import { createActionItem, resolveOpenActionItemsFor, tryResolveActionItem } from "@/lib/action-items";

const LINE_SLOTS = 5;

const LineInputSchema = z.object({
  itemNumber: z.string().trim().min(1),
  description: z.string().trim().min(1),
  uom: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  locationId: z.string().trim().min(1),
  needByDate: z.string().trim().optional(),
});

function parseLines(formData: FormData) {
  const lines: z.infer<typeof LineInputSchema>[] = [];
  const errors: string[] = [];

  for (let i = 0; i < LINE_SLOTS; i++) {
    const itemNumber = formData.get(`itemNumber-${i}`);
    if (!itemNumber || String(itemNumber).trim() === "") continue; // empty slot, skip

    const parsed = LineInputSchema.safeParse({
      itemNumber,
      description: formData.get(`description-${i}`),
      uom: formData.get(`uom-${i}`),
      quantity: formData.get(`quantity-${i}`),
      unitPrice: formData.get(`unitPrice-${i}`),
      locationId: formData.get(`locationId-${i}`),
      needByDate: formData.get(`needByDate-${i}`),
    });
    if (!parsed.success) {
      errors.push(`Line ${i + 1}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      continue;
    }
    lines.push(parsed.data);
  }

  return { lines, errors };
}

export type FormActionState = { error?: string } | undefined;

const CreatePOSchema = z.object({
  supplierId: z.string().trim().min(1, "Choose a supplier."),
});

export async function createPurchaseOrder(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (!user) return { error: "Not signed in." };

  const parsed = CreatePOSchema.safeParse({ supplierId: formData.get("supplierId") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supplier = await db.supplier.findFirst({
    where: { id: parsed.data.supplierId, tenantId: user.tenantId },
  });
  if (!supplier) return { error: "Supplier not found." };

  const { lines, errors } = parseLines(formData);
  if (errors.length > 0) return { error: errors[0] };
  if (lines.length === 0) return { error: "Add at least one line." };

  if (!(await allLocationsBelongToTenant(lines.map((l) => l.locationId), user.tenantId))) {
    return { error: "One or more locations aren't valid for your organization." };
  }

  const scope = await locationScopeFor(user);
  if (scope && lines.some((l) => !scope.includes(l.locationId))) {
    return { error: "You can only create POs for locations you're assigned to." };
  }

  const po = await db.purchaseOrder.create({
    data: {
      tenantId: user.tenantId,
      supplierId: supplier.id,
      status: "DRAFT",
      lines: {
        create: lines.map((l, i) => ({
          lineNumber: i + 1,
          itemNumber: l.itemNumber,
          description: l.description,
          uom: l.uom,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          locationId: l.locationId,
          needByDate: l.needByDate ? new Date(l.needByDate) : null,
        })),
      },
    },
  });

  revalidatePath("/dashboard/purchase-orders");
  redirect(`/dashboard/purchase-orders/${po.id}`);
}

export async function updateDraftPurchaseOrder(
  poId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (!user) return { error: "Not signed in." };

  const po = await db.purchaseOrder.findFirst({ where: { id: poId, tenantId: user.tenantId } });
  if (!po) return { error: "PO not found." };
  if (po.status !== "DRAFT") return { error: "Only draft POs can be edited directly." };

  const parsed = CreatePOSchema.safeParse({ supplierId: formData.get("supplierId") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { lines, errors } = parseLines(formData);
  if (errors.length > 0) return { error: errors[0] };
  if (lines.length === 0) return { error: "Add at least one line." };

  if (!(await allLocationsBelongToTenant(lines.map((l) => l.locationId), user.tenantId))) {
    return { error: "One or more locations aren't valid for your organization." };
  }

  const scope = await locationScopeFor(user);
  if (scope && lines.some((l) => !scope.includes(l.locationId))) {
    return { error: "You can only manage POs for locations you're assigned to." };
  }

  await db.$transaction([
    db.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: poId } }),
    db.purchaseOrder.update({
      where: { id: poId },
      data: {
        supplierId: parsed.data.supplierId,
        lines: {
          create: lines.map((l, i) => ({
            lineNumber: i + 1,
            itemNumber: l.itemNumber,
            description: l.description,
            uom: l.uom,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            locationId: l.locationId,
            needByDate: l.needByDate ? new Date(l.needByDate) : null,
          })),
        },
      },
    }),
  ]);

  revalidatePath(`/dashboard/purchase-orders/${poId}`);
  redirect(`/dashboard/purchase-orders/${poId}`);
}

export async function duplicatePurchaseOrder(poId: string) {
  const user = await getCurrentInternalUser();
  if (!user) return;

  const source = await db.purchaseOrder.findFirst({
    where: { id: poId, tenantId: user.tenantId },
    include: { lines: true },
  });
  if (!source) return;

  const copy = await db.purchaseOrder.create({
    data: {
      tenantId: user.tenantId,
      supplierId: source.supplierId,
      status: "DRAFT",
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

  revalidatePath("/dashboard/purchase-orders");
  redirect(`/dashboard/purchase-orders/${copy.id}`);
}

export async function issuePurchaseOrder(
  poId: string,
  _state: FormActionState,
  _formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (!user) return { error: "Not signed in." };

  const po = await db.purchaseOrder.findFirst({
    where: { id: poId, tenantId: user.tenantId },
    include: { supplier: { include: { contacts: true } } },
  });
  if (!po) return { error: "PO not found." };

  // Block rather than silently issuing into the void: an ISSUED PO with no
  // contact to acknowledge it would carry no PO_ACKNOWLEDGE item and no
  // link for a supplier to ever act on — a non-terminal status nobody is
  // reminded about, exactly the modeling bug the product philosophy rules
  // out. Add a contact to the supplier first.
  const contact = po.supplier.contacts[0];
  if (!contact) {
    return {
      error: `${po.supplier.name} has no contact on file — add one before issuing this PO.`,
    };
  }

  // Atomic guard: only proceed if this request is the one that actually
  // flips DRAFT -> ISSUED. A second concurrent click (or another team
  // member with access to the same PO) gets count 0 and stops here rather
  // than re-issuing or double-creating the acknowledgment action item.
  const result = await db.purchaseOrder.updateMany({
    where: { id: poId, status: "DRAFT" },
    data: { status: "ISSUED" },
  });
  if (result.count === 0) {
    return { error: "This PO already changed — someone beat you to it." };
  }

  await createActionItem({
    tenantId: user.tenantId,
    subjectType: "PURCHASE_ORDER",
    subjectId: po.id,
    actionType: "PO_ACKNOWLEDGE",
    ownerType: "EXTERNAL_USER",
    externalOwnerId: contact.id,
  });

  revalidatePath(`/dashboard/purchase-orders/${poId}`);
  revalidatePath("/dashboard/purchase-orders");
  return undefined;
}

const CancelSchema = z.object({
  reason: z.string().trim().optional(),
});

export async function cancelPurchaseOrder(
  poId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (!user) return { error: "Not signed in." };

  const po = await db.purchaseOrder.findFirst({
    where: { id: poId, tenantId: user.tenantId },
    include: { lines: { select: { id: true } } },
  });
  if (!po) return { error: "PO not found." };

  const parsed = CancelSchema.safeParse({ reason: formData.get("reason") });

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
      cancellationReason: parsed.success ? parsed.data.reason || null : null,
    },
  });
  if (result.count === 0) {
    return { error: "This PO was already cancelled or completed — someone beat you to it." };
  }

  await db.purchaseOrderLine.updateMany({
    where: {
      purchaseOrderId: poId,
      status: { notIn: ["FULFILLED", "CLOSED", "CANCELLED"] },
    },
    data: { status: "CANCELLED" },
  });

  // Cancelling makes any pending review on the PO *or any of its lines*
  // moot — a line-level item (e.g. a supplier's proposed change) left OPEN
  // here would sit in the inbox and daily reminders forever, pointing at a
  // cancelled PO nobody can act on anymore.
  await resolveOpenActionItemsFor("PURCHASE_ORDER", poId);
  await resolveOpenActionItemsFor(
    "PURCHASE_ORDER_LINE",
    po.lines.map((l) => l.id)
  );

  revalidatePath(`/dashboard/purchase-orders/${poId}`);
  revalidatePath("/dashboard/purchase-orders");
  return undefined;
}

// Both accept/reject are visible to every team member with access to this
// PO (an OWNER sees all locations; a MEMBER assigned to this PO's location
// sees it too) — the line is assigned to nobody in particular, so two
// people could plausibly click Accept/Reject around the same time. The
// where-clause re-checks CHANGE_PROPOSED at write time so only the first
// write actually lands; the second gets count 0 and backs off instead of
// re-applying (or worse, re-nulling already-cleared proposed_* fields).

export async function acceptChangeProposal(lineId: string) {
  const user = await getCurrentInternalUser();
  if (!user) return;

  const line = await db.purchaseOrderLine.findFirst({
    where: { id: lineId, purchaseOrder: { tenantId: user.tenantId } },
  });
  if (!line) return;

  const result = await db.purchaseOrderLine.updateMany({
    where: { id: lineId, status: "CHANGE_PROPOSED" },
    data: {
      quantity: line.proposedQuantity ?? line.quantity,
      unitPrice: line.proposedUnitPrice ?? line.unitPrice,
      promiseDate: line.proposedDate ?? line.promiseDate,
      proposedQuantity: null,
      proposedUnitPrice: null,
      proposedDate: null,
      proposedBySupplierContact: null,
      proposedAt: null,
      status: "ACKNOWLEDGED",
    },
  });
  if (result.count === 0) return;

  await resolveOpenActionItemsFor("PURCHASE_ORDER_LINE", lineId);
  revalidatePath(`/dashboard/purchase-orders/${line.purchaseOrderId}`);
}

export async function rejectChangeProposal(lineId: string) {
  const user = await getCurrentInternalUser();
  if (!user) return;

  const line = await db.purchaseOrderLine.findFirst({
    where: { id: lineId, purchaseOrder: { tenantId: user.tenantId } },
  });
  if (!line) return;

  const result = await db.purchaseOrderLine.updateMany({
    where: { id: lineId, status: "CHANGE_PROPOSED" },
    data: {
      proposedQuantity: null,
      proposedUnitPrice: null,
      proposedDate: null,
      proposedBySupplierContact: null,
      proposedAt: null,
      status: "ACKNOWLEDGED",
    },
  });
  if (result.count === 0) return;

  await resolveOpenActionItemsFor("PURCHASE_ORDER_LINE", lineId);
  revalidatePath(`/dashboard/purchase-orders/${line.purchaseOrderId}`);
}

// --- External, token-authorized actions (no session) ---

export async function acknowledgePOByToken(token: string) {
  const item = await db.actionItem.findFirst({
    where: { accessToken: token, actionType: "PO_ACKNOWLEDGE" },
  });
  if (!item) return { error: "This link isn't valid." };

  // Resolve the action item FIRST, atomically — this is the race guard.
  // The link is reopenable (see docs/architecture.md#action-items--reminders)
  // so it's easy to have it open in two tabs, or for the buyer to cancel the
  // PO in the same window the supplier is acknowledging it. Only whichever
  // request actually flips OPEN -> RESOLVED goes on to touch the PO.
  const resolved = await tryResolveActionItem(item.id);
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

  await db.purchaseOrderLine.updateMany({
    where: { purchaseOrderId: item.subjectId, status: "PENDING_ACKNOWLEDGMENT" },
    data: { status: "ACKNOWLEDGED" },
  });

  return { error: undefined };
}

const RejectPOSchema = z.object({ reason: z.string().trim().optional() });

export async function rejectPOByToken(token: string, formData: FormData) {
  const item = await db.actionItem.findFirst({
    where: { accessToken: token, actionType: "PO_ACKNOWLEDGE" },
  });
  if (!item) return { error: "This link isn't valid." };

  const resolved = await tryResolveActionItem(item.id);
  if (!resolved) {
    return { error: "This item was already resolved — no further action needed." };
  }

  const parsed = RejectPOSchema.safeParse({ reason: formData.get("reason") });

  // Same guard as acknowledge: only write REJECTED if the PO is still
  // ISSUED, so a concurrent buyer cancellation can't be overwritten.
  const result = await db.purchaseOrder.updateMany({
    where: { id: item.subjectId, status: "ISSUED" },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectionReason: parsed.success ? parsed.data.reason || null : null,
    },
  });
  if (result.count === 0) {
    return { error: "This purchase order changed before your response could be recorded." };
  }

  const po = await db.purchaseOrder.findFirst({
    where: { id: item.subjectId },
    include: { lines: true },
  });
  if (!po) return { error: undefined };

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
