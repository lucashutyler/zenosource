"use server";

import * as z from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentInternalUser } from "@/lib/dal";

const LINE_SLOTS = 5;

const LineInputSchema = z.object({
  itemNumber: z.string().trim().min(1),
  description: z.string().trim().min(1),
  uom: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  locationId: z.string().trim().optional(),
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

export async function createRFQ(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (!user) return { error: "Not signed in." };

  const { lines, errors } = parseLines(formData);
  if (errors.length > 0) return { error: errors[0] };
  if (lines.length === 0) return { error: "Add at least one line." };

  // Only invite suppliers that actually belong to this tenant — never trust
  // checkbox values from the form directly.
  const requestedSupplierIds = [...new Set(formData.getAll("supplierIds").map(String))];
  const suppliers =
    requestedSupplierIds.length > 0
      ? await db.supplier.findMany({
          where: { id: { in: requestedSupplierIds }, tenantId: user.tenantId },
        })
      : [];

  const rfq = await db.rFQ.create({
    data: {
      tenantId: user.tenantId,
      // Inviting suppliers is effectively sending the RFQ; with none checked
      // it's just a draft.
      status: suppliers.length > 0 ? "SENT" : "DRAFT",
      lines: {
        create: lines.map((l) => ({
          itemNumber: l.itemNumber,
          description: l.description,
          uom: l.uom,
          quantity: l.quantity,
          locationId: l.locationId || null,
          needByDate: l.needByDate ? new Date(l.needByDate) : null,
        })),
      },
      invites: {
        create: suppliers.map((s) => ({ supplierId: s.id, status: "INVITED" })),
      },
    },
  });

  revalidatePath("/dashboard/rfqs");
  redirect(`/dashboard/rfqs/${rfq.id}`);
}

export async function duplicateRFQ(rfqId: string) {
  const user = await getCurrentInternalUser();
  if (!user) return;

  const source = await db.rFQ.findFirst({
    where: { id: rfqId, tenantId: user.tenantId },
    include: { lines: true },
  });
  if (!source) return;

  // Lines only — no invites, no quotes. Just a starting point for a similar RFQ.
  const copy = await db.rFQ.create({
    data: {
      tenantId: user.tenantId,
      status: "DRAFT",
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
    },
  });

  revalidatePath("/dashboard/rfqs");
  redirect(`/dashboard/rfqs/${copy.id}`);
}

// Manual terminal exit for an RFQ that isn't going anywhere (no useful
// quotes, buyer changed their mind, etc). Atomic guard: only proceeds if the
// RFQ isn't already AWARDED or CLOSED, so a stale page can't re-close (a
// no-op) or clobber an award that landed in the meantime.
export async function closeRFQ(rfqId: string) {
  const user = await getCurrentInternalUser();
  if (!user) return;

  const rfq = await db.rFQ.findFirst({ where: { id: rfqId, tenantId: user.tenantId } });
  if (!rfq) return;

  const result = await db.rFQ.updateMany({
    where: { id: rfqId, status: { notIn: ["AWARDED", "CLOSED"] } },
    data: { status: "CLOSED" },
  });
  if (result.count === 0) return;

  revalidatePath(`/dashboard/rfqs/${rfqId}`);
  revalidatePath("/dashboard/rfqs");
}

// Atomic guard: only the request that actually flips status away from
// AWARDED-eligible wins. If two buyers click Award on two different quotes
// for the same RFQ at once, only the first update's WHERE clause matches —
// the second gets count 0 and backs off instead of overwriting the award.
export async function awardRFQQuote(rfqId: string, quoteId: string) {
  const user = await getCurrentInternalUser();
  if (!user) return;

  const rfq = await db.rFQ.findFirst({ where: { id: rfqId, tenantId: user.tenantId } });
  if (!rfq) return;

  const quote = await db.rFQQuote.findFirst({
    where: { id: quoteId, rfqId: rfq.id, status: "SUBMITTED" },
  });
  if (!quote) return;

  const result = await db.rFQ.updateMany({
    where: { id: rfqId, status: { notIn: ["AWARDED", "CLOSED"] } },
    data: { status: "AWARDED", awardedQuoteId: quoteId },
  });
  if (result.count === 0) return;

  revalidatePath(`/dashboard/rfqs/${rfqId}`);
  revalidatePath("/dashboard/rfqs");
}
