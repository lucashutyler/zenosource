import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

// Human-readable document numbers — `P-10418`, `Q-10422`, `L-10007`.
//
// One sequence per tenant, shared across all three classes, so `10418` on
// its own is unambiguous. That matters because the number's real job is to
// survive a phone call and an email subject line: a supplier reading "ten
// four eighteen" to their shop floor shouldn't also have to say which of our
// three counters it came from. Per-entity sequences would collide at
// `10007` three ways.
//
// The class letter is presentation, not identity: `P-10418` and `10418` are
// the same document, and search accepts either.

export const DOCUMENT_CLASS = {
  PURCHASE_ORDER: "P",
  RFQ: "Q",
  PRICE_LIST: "L",
} as const;

export type DocumentClass = (typeof DOCUMENT_CLASS)[keyof typeof DOCUMENT_CLASS];

/**
 * Allocate the next number for a tenant.
 *
 * A single `UPDATE ... RETURNING` — the increment and the read are the same
 * statement, so two concurrent creates can never receive the same number
 * even without an explicit transaction. Counting existing rows
 * (`MAX(number) + 1`) would be the obvious implementation and is a race in
 * every concurrent case; the `@@unique([tenantId, number])` constraint is
 * there as the backstop, not the mechanism.
 *
 * Pass `tx` when allocating inside an interactive transaction, so a rolled
 * back create doesn't burn a number.
 */
export async function allocateDocumentNumber(
  tenantId: string,
  documentClass: DocumentClass,
  tx?: Prisma.TransactionClient
): Promise<string> {
  const client = tx ?? db;
  const rows = await client.$queryRaw<{ nextDocumentNumber: number }[]>`
    UPDATE "Tenant"
       SET "nextDocumentNumber" = "nextDocumentNumber" + 1
     WHERE "id" = ${tenantId}
    RETURNING "nextDocumentNumber" - 1 AS "nextDocumentNumber"
  `;
  const allocated = rows[0]?.nextDocumentNumber;
  if (allocated == null) {
    throw new Error(`Cannot allocate a document number: no tenant ${tenantId}`);
  }
  return `${documentClass}-${allocated}`;
}

/**
 * Normalize what a user typed into something matchable. Accepts `P-10418`,
 * `p 10418`, `10418` — all three are things people actually paste into a
 * search box from an email, and treating them as three different queries is
 * the kind of small friction that sends someone back to Outlook.
 */
export function normalizeDocumentNumberQuery(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/[\s_]/g, "");
  const match = /^([PQL]-?)?(\d{3,})$/.exec(cleaned);
  if (!match) return null;
  return match[2];
}
