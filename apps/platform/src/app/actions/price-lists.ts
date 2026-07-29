"use server";

import * as z from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentInternalUser } from "@/lib/dal";
import { allocateDocumentNumber, DOCUMENT_CLASS } from "@/lib/document-number";
import { parseDateInput } from "@/lib/format";
import { type FormState, fail, failWith } from "@/lib/form-state";

export type FormActionState = FormState;

const MAX_UNIT_PRICE = 10_000_000;
const MAX_MIN_QUANTITY = 10_000_000;

// Price lists were append-only: no edit, no delete, no way to correct a
// mistyped price, and effective dates that accepted `from` after `to` without
// comment. Every mistake was permanent, on the reference data a purchase
// order's unit price is checked against.

const PriceListSchema = z
  .object({
    supplierId: z.string().trim().min(1, "Choose a supplier."),
    effectiveFrom: z.string().trim().optional(),
    effectiveTo: z.string().trim().optional(),
  })
  .refine(
    (v) => {
      if (!v.effectiveFrom || !v.effectiveTo) return true;
      return v.effectiveFrom <= v.effectiveTo;
    },
    { message: "The end date can't be before the start date.", path: ["effectiveTo"] }
  );

export async function createPriceList(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const parsed = PriceListSchema.safeParse({
    supplierId: formData.get("supplierId"),
    effectiveFrom: formData.get("effectiveFrom"),
    effectiveTo: formData.get("effectiveTo"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string") fieldErrors[field] ??= issue.message;
    }
    return fail(formData, fieldErrors);
  }

  const supplier = await db.supplier.findFirst({
    where: { id: parsed.data.supplierId, tenantId: user.tenantId },
  });
  if (!supplier) return fail(formData, { supplierId: "That supplier isn't on your account." });

  const priceList = await db.$transaction(async (tx) => {
    const number = await allocateDocumentNumber(user.tenantId, DOCUMENT_CLASS.PRICE_LIST, tx);
    return tx.priceList.create({
      data: {
        tenantId: user.tenantId,
        number,
        supplierId: supplier.id,
        effectiveFrom: parseDateInput(parsed.data.effectiveFrom),
        effectiveTo: parseDateInput(parsed.data.effectiveTo),
      },
    });
  });

  revalidatePath("/dashboard/price-lists");
  redirect(`/dashboard/price-lists/${priceList.id}`);
}

export async function updatePriceList(
  priceListId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const existing = await db.priceList.findFirst({
    where: { id: priceListId, tenantId: user.tenantId },
  });
  if (!existing) return failWith(formData, "That price list no longer exists.");

  const parsed = PriceListSchema.safeParse({
    supplierId: formData.get("supplierId"),
    effectiveFrom: formData.get("effectiveFrom"),
    effectiveTo: formData.get("effectiveTo"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string") fieldErrors[field] ??= issue.message;
    }
    return fail(formData, fieldErrors);
  }

  await db.priceList.update({
    where: { id: priceListId },
    data: {
      supplierId: parsed.data.supplierId,
      effectiveFrom: parseDateInput(parsed.data.effectiveFrom),
      effectiveTo: parseDateInput(parsed.data.effectiveTo),
    },
  });

  revalidatePath(`/dashboard/price-lists/${priceListId}`);
  return { ok: "Saved." };
}

export async function deletePriceList(priceListId: string) {
  const user = await getCurrentInternalUser();

  const list = await db.priceList.findFirst({
    where: { id: priceListId, tenantId: user.tenantId },
  });
  if (!list) return;

  await db.$transaction(async (tx) => {
    const items = await tx.priceListItem.findMany({
      where: { priceListId },
      select: { id: true },
    });
    await tx.priceBreak.deleteMany({
      where: { priceListItemId: { in: items.map((i) => i.id) } },
    });
    await tx.priceListItem.deleteMany({ where: { priceListId } });
    await tx.priceList.delete({ where: { id: priceListId } });
  });

  revalidatePath("/dashboard/price-lists");
  redirect("/dashboard/price-lists");
}

const AddItemSchema = z.object({
  itemNumber: z.string().trim().min(1, "Item number is required."),
  description: z.string().trim().min(1, "Description is required."),
  uom: z.string().trim().min(1, "Unit of measure is required."),
  minQuantity: z.coerce
    .number({ message: "Minimum quantity must be a number." })
    .int("Use a whole number.")
    .nonnegative("Minimum quantity must be zero or more.")
    .max(MAX_MIN_QUANTITY, "That minimum quantity is out of range."),
  unitPrice: z.coerce
    .number({ message: "Unit price must be a number." })
    .nonnegative("Unit price must be zero or more.")
    .max(MAX_UNIT_PRICE, "That unit price is out of range."),
});

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") fieldErrors[field] ??= issue.message;
  }
  return fieldErrors;
}

export async function addPriceListItem(
  priceListId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const priceList = await db.priceList.findFirst({
    where: { id: priceListId, tenantId: user.tenantId },
  });
  if (!priceList) return failWith(formData, "That price list no longer exists.");

  const parsed = AddItemSchema.safeParse({
    itemNumber: formData.get("itemNumber"),
    description: formData.get("description"),
    uom: formData.get("uom"),
    minQuantity: formData.get("minQuantity"),
    unitPrice: formData.get("unitPrice"),
  });
  if (!parsed.success) return fail(formData, zodFieldErrors(parsed.error));

  // Two rows for the same part on one schedule means "what does SKU-2050 cost
  // today?" has two answers, which is the same as having none.
  const duplicate = await db.priceListItem.findFirst({
    where: { priceListId, itemNumber: parsed.data.itemNumber },
  });
  if (duplicate) {
    return fail(formData, {
      itemNumber: `${parsed.data.itemNumber} is already on this schedule — add a price break to it instead.`,
    });
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
  return { ok: `${parsed.data.itemNumber} added.` };
}

export async function deletePriceListItem(itemId: string) {
  const user = await getCurrentInternalUser();

  const item = await db.priceListItem.findFirst({
    where: { id: itemId, priceList: { tenantId: user.tenantId } },
  });
  if (!item) return;

  await db.$transaction(async (tx) => {
    await tx.priceBreak.deleteMany({ where: { priceListItemId: itemId } });
    await tx.priceListItem.delete({ where: { id: itemId } });
  });

  revalidatePath(`/dashboard/price-lists/${item.priceListId}`);
}

const AddPriceBreakSchema = z.object({
  minQuantity: z.coerce
    .number({ message: "Minimum quantity must be a number." })
    .int("Use a whole number.")
    .nonnegative("Minimum quantity must be zero or more.")
    .max(MAX_MIN_QUANTITY, "That minimum quantity is out of range."),
  unitPrice: z.coerce
    .number({ message: "Unit price must be a number." })
    .nonnegative("Unit price must be zero or more.")
    .max(MAX_UNIT_PRICE, "That unit price is out of range."),
});

export async function addPriceBreak(
  itemId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  // Tenant ownership is checked through the item's parent price list, since
  // PriceListItem has no tenantId of its own.
  const item = await db.priceListItem.findFirst({
    where: { id: itemId, priceList: { tenantId: user.tenantId } },
    include: { priceBreaks: true },
  });
  if (!item) return failWith(formData, "That item no longer exists.");

  const parsed = AddPriceBreakSchema.safeParse({
    minQuantity: formData.get("minQuantity"),
    unitPrice: formData.get("unitPrice"),
  });
  if (!parsed.success) return fail(formData, zodFieldErrors(parsed.error));

  // Two breaks starting at the same quantity make the schedule ambiguous
  // exactly where it's read: at the boundary.
  if (item.priceBreaks.some((b) => b.minQuantity === parsed.data.minQuantity)) {
    return fail(formData, {
      minQuantity: `There's already a break starting at ${parsed.data.minQuantity}.`,
    });
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
  return { ok: "Price break added." };
}

export async function deletePriceBreak(breakId: string) {
  const user = await getCurrentInternalUser();

  const priceBreak = await db.priceBreak.findFirst({
    where: { id: breakId, priceListItem: { priceList: { tenantId: user.tenantId } } },
    include: { priceListItem: { select: { priceListId: true, id: true } } },
  });
  if (!priceBreak) return;

  // The last break is the price. Removing it leaves an item that claims to
  // have a negotiated rate and can't say what it is.
  const remaining = await db.priceBreak.count({
    where: { priceListItemId: priceBreak.priceListItem.id },
  });
  if (remaining <= 1) return;

  await db.priceBreak.delete({ where: { id: breakId } });
  revalidatePath(`/dashboard/price-lists/${priceBreak.priceListItem.priceListId}`);
}

export async function duplicatePriceList(priceListId: string) {
  const user = await getCurrentInternalUser();

  const source = await db.priceList.findFirst({
    where: { id: priceListId, tenantId: user.tenantId },
    include: { items: { include: { priceBreaks: true } } },
  });
  if (!source) return;

  const copy = await db.$transaction(async (tx) => {
    const number = await allocateDocumentNumber(user.tenantId, DOCUMENT_CLASS.PRICE_LIST, tx);
    return tx.priceList.create({
      data: {
        tenantId: user.tenantId,
        number,
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
  });

  revalidatePath("/dashboard/price-lists");
  redirect(`/dashboard/price-lists/${copy.id}`);
}
