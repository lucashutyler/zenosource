"use server";

import * as z from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentInternalUser } from "@/lib/dal";
import { type FormState, fail, failWith } from "@/lib/form-state";

export type FormActionState = FormState;

const LocationSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  code: z.string().trim().min(1, "Code is required."),
  addressLine1: z.string().trim().optional(),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().optional(),
  region: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  country: z.string().trim().optional(),
});

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") fieldErrors[field] ??= issue.message;
  }
  return fieldErrors;
}

export async function createLocation(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  // Locations define the scope MEMBERs are restricted to, so managing them
  // is OWNER-only — the fixed permission matrix from docs/todo.md's Phase 1a.
  if (user.role !== "OWNER") {
    return failWith(formData, "Only owners can add locations.");
  }

  const parsed = LocationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(formData, zodFieldErrors(parsed.error));

  const existing = await db.location.findUnique({
    where: { tenantId_code: { tenantId: user.tenantId, code: parsed.data.code } },
  });
  if (existing) {
    return fail(formData, { code: `Code "${parsed.data.code}" is already in use.` });
  }

  const location = await db.location.create({
    data: {
      tenantId: user.tenantId,
      name: parsed.data.name,
      code: parsed.data.code,
      // The schema carried street address and postal code all along; the form
      // asked for neither, so the address on a PO was a city and a country.
      addressLine1: parsed.data.addressLine1 || null,
      addressLine2: parsed.data.addressLine2 || null,
      city: parsed.data.city || null,
      region: parsed.data.region || null,
      postalCode: parsed.data.postalCode || null,
      country: parsed.data.country || null,
    },
  });

  revalidatePath("/dashboard/locations");
  redirect(`/dashboard/locations/${location.id}`);
}

export async function updateLocation(
  locationId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") {
    return failWith(formData, "Only owners can edit locations.");
  }

  const location = await db.location.findFirst({
    where: { id: locationId, tenantId: user.tenantId },
  });
  if (!location) return failWith(formData, "That location no longer exists.");

  const parsed = LocationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(formData, zodFieldErrors(parsed.error));

  const clash = await db.location.findFirst({
    where: { tenantId: user.tenantId, code: parsed.data.code, id: { not: locationId } },
  });
  if (clash) return fail(formData, { code: `Code "${parsed.data.code}" is already in use.` });

  await db.location.update({
    where: { id: locationId },
    data: {
      name: parsed.data.name,
      code: parsed.data.code,
      addressLine1: parsed.data.addressLine1 || null,
      addressLine2: parsed.data.addressLine2 || null,
      city: parsed.data.city || null,
      region: parsed.data.region || null,
      postalCode: parsed.data.postalCode || null,
      country: parsed.data.country || null,
    },
  });

  revalidatePath(`/dashboard/locations/${locationId}`);
  revalidatePath("/dashboard/locations");
  return { ok: "Saved." };
}

export async function setLocationStatus(locationId: string, active: boolean) {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") return;

  const location = await db.location.findFirst({
    where: { id: locationId, tenantId: user.tenantId },
  });
  if (!location) return;

  await db.location.update({
    where: { id: locationId },
    data: { status: active ? "ACTIVE" : "INACTIVE" },
  });

  revalidatePath(`/dashboard/locations/${locationId}`);
  revalidatePath("/dashboard/locations");
}

const AssignUserSchema = z.object({
  internalUserId: z.string().trim().min(1, "Choose a user."),
});

export async function assignUserToLocation(
  locationId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  // Without this gate a MEMBER could self-assign to any location in the
  // tenant, permanently widening their own PO/RFQ visibility — assignment
  // is an access-control decision, not a convenience toggle.
  if (user.role !== "OWNER") {
    return failWith(formData, "Only owners can manage location assignments.");
  }

  const location = await db.location.findFirst({
    where: { id: locationId, tenantId: user.tenantId },
  });
  if (!location) return failWith(formData, "That location no longer exists.");

  const parsed = AssignUserSchema.safeParse({
    internalUserId: formData.get("internalUserId"),
  });
  if (!parsed.success) return fail(formData, zodFieldErrors(parsed.error));

  const targetUser = await db.internalUser.findFirst({
    where: { id: parsed.data.internalUserId, tenantId: user.tenantId },
  });
  if (!targetUser) return fail(formData, { internalUserId: "That user isn't on your account." });

  await db.internalUserLocation.upsert({
    where: {
      internalUserId_locationId: { internalUserId: targetUser.id, locationId },
    },
    create: { internalUserId: targetUser.id, locationId },
    update: {},
  });

  revalidatePath(`/dashboard/locations/${locationId}`);
  return { ok: `${targetUser.name} assigned.` };
}

/**
 * Remove an assignment.
 *
 * Assignment was one-way: once a user was granted a location there was no way
 * to take it back. That is an access-control gap, not a missing convenience —
 * someone who moves teams keeps seeing every order at their old plant forever.
 */
export async function unassignUserFromLocation(locationId: string, internalUserId: string) {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") return;

  const location = await db.location.findFirst({
    where: { id: locationId, tenantId: user.tenantId },
  });
  if (!location) return;

  await db.internalUserLocation.deleteMany({ where: { locationId, internalUserId } });

  revalidatePath(`/dashboard/locations/${locationId}`);
}
