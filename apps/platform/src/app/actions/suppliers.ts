"use server";

import * as z from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentInternalUser } from "@/lib/dal";
import { type FormState, fail, failWith } from "@/lib/form-state";

export type FormActionState = FormState;

const SupplierSchema = z.object({
  name: z.string().trim().min(1, "Supplier name is required."),
  primaryContactName: z.string().trim().optional(),
  primaryContactEmail: z
    .union([z.literal(""), z.string().trim().email("Enter a valid email address.")])
    .optional(),
});

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") fieldErrors[field] ??= issue.message;
  }
  return fieldErrors;
}

export async function createSupplier(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const parsed = SupplierSchema.safeParse({
    name: formData.get("name"),
    primaryContactName: formData.get("primaryContactName"),
    primaryContactEmail: formData.get("primaryContactEmail"),
  });
  if (!parsed.success) return fail(formData, zodFieldErrors(parsed.error));

  const supplier = await db.$transaction(async (tx) => {
    const created = await tx.supplier.create({
      data: {
        tenantId: user.tenantId,
        name: parsed.data.name,
        primaryContactName: parsed.data.primaryContactName || null,
        primaryContactEmail: parsed.data.primaryContactEmail || null,
      },
    });

    // Make the primary contact real.
    //
    // The create form asked for a contact name and email, stored them as two
    // loose strings on Supplier, and created no SupplierContact — so a
    // supplier looked ready to use and then blocked at issue time with "has
    // no contact on file", pointing at a field the user had already filled in.
    if (parsed.data.primaryContactName && parsed.data.primaryContactEmail) {
      await tx.supplierContact.create({
        data: {
          supplierId: created.id,
          name: parsed.data.primaryContactName,
          email: parsed.data.primaryContactEmail,
        },
      });
    }

    return created;
  });

  revalidatePath("/dashboard/suppliers");
  redirect(`/dashboard/suppliers/${supplier.id}`);
}

export async function updateSupplier(
  supplierId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, tenantId: user.tenantId },
  });
  if (!supplier) return failWith(formData, "That supplier no longer exists.");

  const parsed = SupplierSchema.safeParse({
    name: formData.get("name"),
    primaryContactName: formData.get("primaryContactName"),
    primaryContactEmail: formData.get("primaryContactEmail"),
  });
  if (!parsed.success) return fail(formData, zodFieldErrors(parsed.error));

  await db.supplier.update({
    where: { id: supplierId },
    data: {
      name: parsed.data.name,
      primaryContactName: parsed.data.primaryContactName || null,
      primaryContactEmail: parsed.data.primaryContactEmail || null,
    },
  });

  revalidatePath(`/dashboard/suppliers/${supplierId}`);
  revalidatePath("/dashboard/suppliers");
  return { ok: "Saved." };
}

/**
 * Deactivate rather than delete. The `INACTIVE` badge already rendered on the
 * supplier list; nothing in the app could ever set it, so it was decoration
 * for a state the product couldn't reach.
 */
export async function setSupplierStatus(supplierId: string, active: boolean) {
  const user = await getCurrentInternalUser();

  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, tenantId: user.tenantId },
  });
  if (!supplier) return;

  await db.supplier.update({
    where: { id: supplierId },
    data: { status: active ? "ACTIVE" : "INACTIVE" },
  });

  revalidatePath(`/dashboard/suppliers/${supplierId}`);
  revalidatePath("/dashboard/suppliers");
}

const ContactSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().email("Enter a valid email address."),
});

export async function addSupplierContact(
  supplierId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, tenantId: user.tenantId },
  });
  if (!supplier) return failWith(formData, "That supplier no longer exists.");

  const parsed = ContactSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });
  if (!parsed.success) return fail(formData, zodFieldErrors(parsed.error));

  // `@@unique([supplierId, email])` used to surface as an unhandled Prisma
  // exception and a framework error page, losing the form.
  const duplicate = await db.supplierContact.findFirst({
    where: { supplierId, email: parsed.data.email },
  });
  if (duplicate) {
    return fail(formData, { email: `${parsed.data.email} is already a contact for this supplier.` });
  }

  await db.supplierContact.create({
    data: { supplierId, name: parsed.data.name, email: parsed.data.email },
  });

  revalidatePath(`/dashboard/suppliers/${supplierId}`);
  return { ok: `${parsed.data.name} added.` };
}

export async function updateSupplierContact(
  contactId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const contact = await db.supplierContact.findFirst({
    where: { id: contactId, supplier: { tenantId: user.tenantId } },
  });
  if (!contact) return failWith(formData, "That contact no longer exists.");

  const parsed = ContactSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });
  if (!parsed.success) return fail(formData, zodFieldErrors(parsed.error));

  const duplicate = await db.supplierContact.findFirst({
    where: {
      supplierId: contact.supplierId,
      email: parsed.data.email,
      id: { not: contactId },
    },
  });
  if (duplicate) {
    return fail(formData, { email: `${parsed.data.email} is already a contact for this supplier.` });
  }

  await db.supplierContact.update({
    where: { id: contactId },
    data: { name: parsed.data.name, email: parsed.data.email },
  });

  revalidatePath(`/dashboard/suppliers/${contact.supplierId}`);
  return { ok: "Saved." };
}

/**
 * Deactivate a contact instead of deleting them.
 *
 * Deleting would orphan resolved action items and destroy the record of who
 * acknowledged what. Deactivating stops the chase — `runReminderJob` skips
 * INACTIVE contacts — which is the actual problem: reminders going to
 * somebody who left the supplier is how a chase silently stops working while
 * the board still looks fine on our side.
 */
export async function setSupplierContactStatus(contactId: string, active: boolean) {
  const user = await getCurrentInternalUser();

  const contact = await db.supplierContact.findFirst({
    where: { id: contactId, supplier: { tenantId: user.tenantId } },
  });
  if (!contact) return;

  await db.supplierContact.update({
    where: { id: contactId },
    data: { status: active ? "ACTIVE" : "INACTIVE" },
  });

  // Open items owned by a contact who has left need a new owner, not silence.
  if (!active) {
    const replacement = await db.supplierContact.findFirst({
      where: { supplierId: contact.supplierId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });
    if (replacement) {
      await db.actionItem.updateMany({
        where: { externalOwnerId: contactId, status: "OPEN" },
        data: { externalOwnerId: replacement.id, lastRemindedAt: null },
      });
    }
  }

  revalidatePath(`/dashboard/suppliers/${contact.supplierId}`);
}
