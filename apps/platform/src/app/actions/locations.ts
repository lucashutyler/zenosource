"use server";

import * as z from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentInternalUser } from "@/lib/dal";

const CreateLocationSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  code: z.string().trim().min(1, "Code is required."),
  city: z.string().trim().optional(),
  region: z.string().trim().optional(),
  country: z.string().trim().optional(),
});

export type FormActionState = { error?: string } | undefined;

export async function createLocation(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (!user) return { error: "Not signed in." };
  // Locations define the scope MEMBERs are restricted to, so managing them
  // is OWNER-only — the fixed permission matrix from docs/todo.md's Phase 1a.
  if (user.role !== "OWNER") return { error: "Only owners can add locations." };

  const parsed = CreateLocationSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
    city: formData.get("city"),
    region: formData.get("region"),
    country: formData.get("country"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const existing = await db.location.findUnique({
    where: { tenantId_code: { tenantId: user.tenantId, code: parsed.data.code } },
  });
  if (existing) return { error: `Code "${parsed.data.code}" is already in use.` };

  const location = await db.location.create({
    data: {
      tenantId: user.tenantId,
      name: parsed.data.name,
      code: parsed.data.code,
      city: parsed.data.city || null,
      region: parsed.data.region || null,
      country: parsed.data.country || null,
    },
  });

  revalidatePath("/dashboard/locations");
  redirect(`/dashboard/locations/${location.id}`);
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
  if (!user) return { error: "Not signed in." };
  // Without this gate a MEMBER could self-assign to any location in the
  // tenant, permanently widening their own PO/RFQ visibility — assignment
  // is an access-control decision, not a convenience toggle.
  if (user.role !== "OWNER") return { error: "Only owners can manage location assignments." };

  const location = await db.location.findFirst({
    where: { id: locationId, tenantId: user.tenantId },
  });
  if (!location) return { error: "Location not found." };

  const parsed = AssignUserSchema.safeParse({
    internalUserId: formData.get("internalUserId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const targetUser = await db.internalUser.findFirst({
    where: { id: parsed.data.internalUserId, tenantId: user.tenantId },
  });
  if (!targetUser) return { error: "User not found." };

  await db.internalUserLocation.upsert({
    where: {
      internalUserId_locationId: {
        internalUserId: targetUser.id,
        locationId,
      },
    },
    create: { internalUserId: targetUser.id, locationId },
    update: {},
  });

  revalidatePath(`/dashboard/locations/${locationId}`);
  return undefined;
}
