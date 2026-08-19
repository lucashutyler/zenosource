import type { CanonicalPOSuggestion } from "../types";
import { bool, dateOnly, decimalString, field, int, text } from "./scalars";

// Erp.BO.POSuggSvc -> POSuggestion.
//
// Read-only, permanently. docs/integrations.md#epicor-erp: the pipeline is
// demand -> MRP -> POReqSvc requisition -> POSuggSvc suggestion -> firm PO,
// and suggestions "cannot be created directly via REST — write attempts fail
// (e.g. 'Suggestion is no longer valid')." This mapper therefore has no
// inverse, and the buyer's decision goes back through the requisition path in
// baq.ts instead. That is a property of Epicor's data model, not a gap in
// this connector.

export function mapSuggestion(row: Record<string, unknown>): CanonicalPOSuggestion | null {
  // Suggestions have no single natural key across MRP runs; the composite of
  // the suggestion's own number and line is what Epicor uses to address one.
  const number = text(field(row, "SugNum", "PONum", "SuggestionNum"));
  const line = int(field(row, "POLine", "SugLine")) ?? 0;
  const supplierExternalRef = text(field(row, "VendorNum"));
  const itemNumber = text(field(row, "PartNum"));
  const suggestedQuantity = decimalString(field(row, "OrderQty", "SugQty", "Quantity"));
  const suggestedDate = dateOnly(field(row, "DueDate", "RequiredDate"));

  if (!number || !supplierExternalRef || !itemNumber || !suggestedQuantity || !suggestedDate) {
    return null;
  }

  return {
    externalRef: `${number}-${line}`,
    supplierExternalRef,
    itemNumber,
    description: text(field(row, "PartDescription", "LineDesc", "Description")) ?? itemNumber,
    suggestedQuantity,
    suggestedDate,
    suggestedUnitPrice: decimalString(field(row, "UnitCost", "DocUnitCost")) ?? null,
    // MRP reruns constantly and withdraws what it previously proposed. A
    // withdrawn suggestion has to be marked SUPERSEDED rather than left OPEN,
    // or a buyer is chased to act on demand that no longer exists — the
    // reminder loop would keep asking, which is the failure mode this product
    // exists to prevent rather than cause.
    withdrawn: bool(field(row, "Ignore", "Void", "Deleted")) ?? false,
  };
}
