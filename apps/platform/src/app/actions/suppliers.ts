"use server";

import * as z from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentInternalUser } from "@/lib/dal";

const CreateSupplierSchema = z.object({
  name: z.string().trim().min(1, "Supplier name is required."),
  primaryContactName: z.string().trim().optional(),
  primaryContactEmail: z
    .string()
    .trim()
    .email("Enter a valid email.")
    .optional()
    .or(z.literal("")),
});

export type FormActionState = { error?: string } | undefined;

export async function createSupplier(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (!user) return { error: "Not signed in." };

  const parsed = CreateSupplierSchema.safeParse({
    name: formData.get("name"),
    primaryContactName: formData.get("primaryContactName"),
    primaryContactEmail: formData.get("primaryContactEmail"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supplier = await db.supplier.create({
    data: {
      tenantId: user.tenantId,
      name: parsed.data.name,
      primaryContactName: parsed.data.primaryContactName || null,
      primaryContactEmail: parsed.data.primaryContactEmail || null,
    },
  });

  revalidatePath("/dashboard/suppliers");
  redirect(`/dashboard/suppliers/${supplier.id}`);
}

const AddContactSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().email("Enter a valid email."),
});

export async function addSupplierContact(
  supplierId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (!user) return { error: "Not signed in." };

  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, tenantId: user.tenantId },
  });
  if (!supplier) return { error: "Supplier not found." };

  const parsed = AddContactSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await db.supplierContact.create({
    data: { supplierId, name: parsed.data.name, email: parsed.data.email },
  });

  revalidatePath(`/dashboard/suppliers/${supplierId}`);
  return undefined;
}
