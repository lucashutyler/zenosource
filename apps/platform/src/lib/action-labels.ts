import type { ActionItemType } from "@/generated/prisma/enums";

// Illustrative, not exhaustive — see docs/data-model.md#actionitem. Shared
// across the dashboard inbox, the external action view, and reminder
// emails so the wording never drifts between them.
export const ACTION_LABELS: Record<ActionItemType, string> = {
  PO_ACKNOWLEDGE: "Acknowledge purchase order",
  PO_REVIEW_CHANGE_PROPOSAL: "Review supplier-proposed change",
  PO_REVIEW_REJECTION: "Review rejected purchase order",
  RFQ_SUBMIT_QUOTE: "Submit RFQ quote",
  RFQ_AWARD_DECISION: "Decide RFQ award",
  PO_SUGGESTION_REVIEW: "Review PO suggestion",
};
