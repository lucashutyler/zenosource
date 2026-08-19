import type { CanonicalSupplier } from "../types";
import { bool, field, text } from "./scalars";

/**
 * Erp.BO.VendorSvc row -> Supplier.
 *
 * `VendorNum` is the external ref, not `VendorID`: VendorNum is the surrogate
 * key Epicor's own foreign keys use (PODetail.VendorNum, VendPart.VendorNum),
 * while VendorID is a human-assigned code a buyer can and does re-key. Matching
 * on the mutable one would orphan every mirrored PO the day someone tidies up
 * a supplier code.
 */
export function mapSupplier(row: Record<string, unknown>): CanonicalSupplier | null {
  const externalRef = text(field(row, "VendorNum", "VendorNumber"));
  const name = text(field(row, "Name", "VendorName"));
  if (!externalRef || !name) return null;

  // Epicor's flag is `Inactive`; ZenoSource's is `active`. Inverting here
  // rather than anywhere downstream keeps the platform's vocabulary positive.
  const inactive = bool(field(row, "Inactive")) ?? false;

  return {
    externalRef,
    name,
    primaryContactName: text(field(row, "PrimPConName", "ContactName")) ?? null,
    primaryContactEmail: text(field(row, "EMailAddress", "EmailAddress", "PrimPConEmail")) ?? null,
    active: !inactive,
  };
}
