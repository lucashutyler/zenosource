"use server";

import * as z from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentInternalUser } from "@/lib/dal";

export type FormActionState = { error?: string } | undefined;

const CreatePriceListSchema = z.object({
  supplierId: z.string().trim().min(1, "Choose a supplier."),
  effectiveFrom: z.string().trim().optional(),
  effectiveTo: z.string().trim().optional(),
});

export async function createPriceList(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (!user) return { error: "Not signed in." };

  const parsed = CreatePriceListSchema.safeParse({
    supplierId: formData.get("supplierId"),
    effectiveFrom: formData.get("effectiveFrom"),
    effectiveTo: formData.get("effectiveTo"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supplier = await db.supplier.findFirst({
    where: { id: parsed.data.supplierId, tenantId: user.tenantId },
  });
  if (!supplier) return { error: "Supplier not found." };

  const priceList = await db.priceList.create({
    data: {
      tenantId: user.tenantId,
      supplierId: supplier.id,
      effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : null,
      effectiveTo: parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null,
    },
  });

  revalidatePath("/dashboard/price-lists");
  redirect(`/dashboard/price-lists/${priceList.id}`);
}

const AddItemSchema = z.object({
  itemNumber: z.string().trim().min(1, "Item number is required."),
  description: z.string().trim().min(1, "Description is required."),
  uom: z.string().trim().min(1, "UOM is required."),
  minQuantity: z.coerce.number().int().nonnegative("Minimum quantity must be zero or more."),
  unitPrice: z.coerce.number().nonnegative("Unit price must be zero or more."),
});

export async function addPriceListItem(
  priceListId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (!user) return { error: "Not signed in." };

  const priceList = await db.priceList.findFirst({
    where: { id: priceListId, tenantId: user.tenantId },
  });
  if (!priceList) return { error: "Price list not found." };

  const parsed = AddItemSchema.safeParse({
    itemNumber: formData.get("itemNumber"),
    description: formData.get("description"),
    uom: formData.get("uom"),
    minQuantity: formData.get("minQuantity"),
    unitPrice: formData.get("unitPrice"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await db.priceListItem.create({
    data: {
      priceListId,
      itemNumber: parsed.data.itemNumber,
      description: parsed.data.description,
      uom: parsed.data.uom,
      priceBreaks: {
        create: [
          {
            minQuantity: parsed.data.minQuantity,
            unitPrice: parsed.data.unitPrice,
            currency: "USD",
          },
        ],
      },
    },
  });

  revalidatePath(`/dashboard/price-lists/${priceListId}`);
  return undefined;
}

const AddPriceBreakSchema = z.object({
  minQuantity: z.coerce.number().int().nonnegative("Minimum quantity must be zero or more."),
  unitPrice: z.coerce.number().nonnegative("Unit price must be zero or more."),
});

export async function addPriceBreak(
  itemId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (!user) return { error: "Not signed in." };

  // Tenant ownership is checked through the item's parent price list, since
  // PriceListItem has no tenantId of its own.
  const item = await db.priceListItem.findFirst({
    where: { id: itemId, priceList: { tenantId: user.tenantId } },
  });
  if (!item) return { error: "Item not found." };

  const parsed = AddPriceBreakSchema.safeParse({
    minQuantity: formData.get("minQuantity"),
    unitPrice: formData.get("unitPrice"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await db.priceBreak.create({
    data: {
      priceListItemId: item.id,
      minQuantity: parsed.data.minQuantity,
      unitPrice: parsed.data.unitPrice,
      currency: "USD",
    },
  });

  revalidatePath(`/dashboard/price-lists/${item.priceListId}`);
  return undefined;
}

export async function duplicatePriceList(priceListId: string) {
  const user = await getCurrentInternalUser();
  if (!user) return;

  const source = await db.priceList.findFirst({
    where: { id: priceListId, tenantId: user.tenantId },
    include: { items: { include: { priceBreaks: true } } },
  });
  if (!source) return;

  const copy = await db.priceList.create({
    data: {
      tenantId: user.tenantId,
      supplierId: source.supplierId,
      effectiveFrom: source.effectiveFrom,
      effectiveTo: source.effectiveTo,
      items: {
        create: source.items.map((item) => ({
          itemNumber: item.itemNumber,
          description: item.description,
          uom: item.uom,
          priceBreaks: {
            create: item.priceBreaks.map((pb) => ({
              minQuantity: pb.minQuantity,
              unitPrice: pb.unitPrice,
              currency: pb.currency,
            })),
          },
        })),
      },
    },
  });

  revalidatePath("/dashboard/price-lists");
  redirect(`/dashboard/price-lists/${copy.id}`);
}
