import type {
  ActionItemType,
  PurchaseOrderStatus,
  PurchaseOrderLineStatus,
  RFQStatus,
} from "@/generated/prisma/enums";

// The product's vocabulary, in one file.
//
// docs/product.md: "every state a PO or RFQ can be in resolves to an open
// action owned by someone... a status nobody is being reminded to act on is
// a modeling bug." That claim is only true if something enforces it, so this
// module states, for every status: whose court the work is in, and which
// action item that status is supposed to mint. `UNCHASED_STATUSES` is the
// explicit list of exceptions — terminal states where nobody owes anything —
// and anything not on it that mints no item is a bug, which
// src/lib/lifecycle.test.ts asserts rather than leaving to review.
//
// It also owns the *words*. The audit found "Save RFQ" on a button that
// emails three suppliers, and two divergent copies of the action-label map
// one of which carried a comment explaining it existed so wording could
// never drift. Every user-visible name for a state or an action comes from
// here.

/** Whose move it is. The dashboard's central split, and the possession strip's. */
export type Court = "BUYER" | "SUPPLIER" | "NOBODY";

// --- Purchase orders -------------------------------------------------------

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  ACKNOWLEDGED: "Acknowledged",
  REJECTED: "Rejected",
  IN_PROGRESS: "Part received",
  FULFILLED: "Received",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const PO_COURT: Record<PurchaseOrderStatus, Court> = {
  DRAFT: "BUYER",
  ISSUED: "SUPPLIER",
  ACKNOWLEDGED: "SUPPLIER",
  IN_PROGRESS: "SUPPLIER",
  REJECTED: "BUYER",
  FULFILLED: "BUYER",
  CLOSED: "NOBODY",
  CANCELLED: "NOBODY",
};

/**
 * The action item each PO status is supposed to have open. `null` means
 * deliberately unchased — see UNCHASED_STATUSES for why each one qualifies.
 */
export const PO_EXPECTED_ACTION: Record<PurchaseOrderStatus, ActionItemType | null> = {
  DRAFT: "PO_ISSUE_DRAFT",
  ISSUED: "PO_ACKNOWLEDGE",
  ACKNOWLEDGED: "PO_DELIVER",
  IN_PROGRESS: "PO_DELIVER",
  REJECTED: "PO_REVIEW_REJECTION",
  FULFILLED: "PO_CLOSE",
  CLOSED: null,
  CANCELLED: null,
};

export const PO_LINE_STATUS_LABEL: Record<PurchaseOrderLineStatus, string> = {
  PENDING_ACKNOWLEDGMENT: "Awaiting acknowledgment",
  ACKNOWLEDGED: "Acknowledged",
  CHANGE_PROPOSED: "Change proposed",
  PARTIALLY_RECEIVED: "Part received",
  FULFILLED: "Received",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

/** Statuses past which no more work happens on a line. */
export const TERMINAL_LINE_STATUSES: PurchaseOrderLineStatus[] = [
  "FULFILLED",
  "CLOSED",
  "CANCELLED",
];

export const TERMINAL_PO_STATUSES: PurchaseOrderStatus[] = ["CLOSED", "CANCELLED"];

// --- RFQs ------------------------------------------------------------------

export const RFQ_STATUS_LABEL: Record<RFQStatus, string> = {
  DRAFT: "Draft",
  SENT: "Out for quote",
  RESPONSES_OPEN: "Quotes in",
  AWARDED: "Awarded",
  CLOSED: "Closed",
};

export const RFQ_COURT: Record<RFQStatus, Court> = {
  DRAFT: "BUYER",
  SENT: "SUPPLIER",
  RESPONSES_OPEN: "BUYER",
  AWARDED: "BUYER",
  CLOSED: "NOBODY",
};

export const RFQ_EXPECTED_ACTION: Record<RFQStatus, ActionItemType | null> = {
  DRAFT: "RFQ_SEND_DRAFT",
  SENT: "RFQ_SUBMIT_QUOTE",
  RESPONSES_OPEN: "RFQ_AWARD_DECISION",
  AWARDED: "RFQ_RAISE_PO_FROM_AWARD",
  CLOSED: null,
};

export const TERMINAL_RFQ_STATUSES: RFQStatus[] = ["CLOSED"];

/**
 * The full list of states we deliberately do not chase, with the reason.
 * Wave 4 of docs/todo.md required this be written down rather than inferred:
 * an unchased state is either a considered decision or the modeling bug, and
 * the difference has to be legible.
 */
export const UNCHASED_STATUSES: { entity: string; status: string; because: string }[] = [
  {
    entity: "PurchaseOrder",
    status: "CLOSED",
    because: "Received and closed out. Nothing is owed by either side.",
  },
  {
    entity: "PurchaseOrder",
    status: "CANCELLED",
    because:
      "Withdrawn by the buyer. The supplier was told at cancellation time; there is no follow-up to chase.",
  },
  {
    entity: "RFQ",
    status: "CLOSED",
    because:
      "Awarded and raised, or abandoned. An awarded RFQ carries RFQ_RAISE_PO_FROM_AWARD until the PO exists, and only then closes.",
  },
];

// --- Action items ----------------------------------------------------------

export type ActionSide = "BUYER" | "SUPPLIER";

type ActionCopy = {
  /** Who owes it. Drives the you-owe / they-owe split. */
  side: ActionSide;
  /** Internal label — the buyer's inbox, list columns, reports. */
  label: string;
  /**
   * The owed thing as a verb phrase, for the `WHAT'S OWED` sentence:
   * "Precision Parts: acknowledge" / "You: review the rejection".
   */
  owes: string;
  /**
   * What the supplier is asked to do, in their words, on the external
   * surface and in email. Empty for buyer-owned actions, which suppliers
   * never see.
   */
  external: string;
};

export const ACTION_COPY: Record<ActionItemType, ActionCopy> = {
  PO_ISSUE_DRAFT: {
    side: "BUYER",
    label: "Issue this draft",
    owes: "issue it",
    external: "",
  },
  PO_ACKNOWLEDGE: {
    side: "SUPPLIER",
    label: "Waiting on acknowledgment",
    owes: "acknowledge",
    external: "Confirm you can meet this order",
  },
  PO_REVIEW_CHANGE_PROPOSAL: {
    side: "BUYER",
    label: "Decide on a proposed change",
    owes: "decide on the proposed change",
    external: "",
  },
  PO_REVIEW_REJECTION: {
    side: "BUYER",
    label: "Respond to a rejection",
    owes: "respond to the rejection",
    external: "",
  },
  PO_DELIVER: {
    side: "SUPPLIER",
    label: "Waiting on delivery",
    owes: "deliver",
    external: "Deliver against this order",
  },
  PO_CLOSE: {
    side: "BUYER",
    label: "Close out a received order",
    owes: "close it out",
    external: "",
  },
  RFQ_SEND_DRAFT: {
    side: "BUYER",
    label: "Send this draft RFQ",
    owes: "send it",
    external: "",
  },
  RFQ_SUBMIT_QUOTE: {
    side: "SUPPLIER",
    label: "Waiting on a quote",
    owes: "quote",
    external: "Send your price and lead time",
  },
  RFQ_AWARD_DECISION: {
    side: "BUYER",
    label: "Award or close this RFQ",
    owes: "award it",
    external: "",
  },
  RFQ_RAISE_PO_FROM_AWARD: {
    side: "BUYER",
    label: "Raise the PO for an award",
    owes: "raise the PO",
    external: "",
  },
  PO_SUGGESTION_REVIEW: {
    side: "BUYER",
    label: "Review a PO suggestion",
    owes: "review the suggestion",
    external: "",
  },
};

/**
 * Backwards-compatible flat label map. Exhaustive by construction now — the
 * old copy in `a/[token]/page.tsx` was a hand-maintained partial that
 * rendered raw enum names for anything it had missed.
 */
export const ACTION_LABELS: Record<ActionItemType, string> = Object.fromEntries(
  Object.entries(ACTION_COPY).map(([type, copy]) => [type, copy.label])
) as Record<ActionItemType, string>;

export function actionSide(type: ActionItemType): ActionSide {
  return ACTION_COPY[type]?.side ?? "BUYER";
}

/**
 * The `WHAT'S OWED` cell — a sentence, not a status noun. A ledger row that
 * says `issued` makes the reader translate; one that says
 * "Precision Parts: acknowledge" doesn't.
 */
export function whatsOwed(params: {
  actionType: ActionItemType | null;
  supplierName: string;
  /** Set when the open item belongs to the person reading the screen. */
  ownedByViewer?: boolean;
  /** Terminal-state fallback, e.g. "closed 14 Jun". */
  settled?: string;
}): string {
  if (!params.actionType) {
    return params.settled ? `Nobody — ${params.settled}` : "Nobody";
  }
  const copy = ACTION_COPY[params.actionType];
  if (!copy) return "—";
  if (copy.side === "SUPPLIER") return `${params.supplierName}: ${copy.owes}`;
  return `${params.ownedByViewer ? "You" : "Us"}: ${copy.owes}`;
}
