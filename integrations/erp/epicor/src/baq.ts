import { EpicorClient } from "./client";
import type { EpicorConfig } from "./config";
import { EpicorError } from "./errors";
import type { PurchaseOrderWriteBack, SuggestionDecision, WriteBackResult } from "./types";

// The write side, through Updatable BAQs.
//
// docs/integrations.md#epicor-erp: "prefer curated Updatable BAQs as the
// integration surface for anything beyond simple reads, rather than calling
// raw BOs directly. This is the common ISV pattern for Epicor integrations —
// it lets the integration shape a purpose-built view (e.g., 'open PO lines
// needing supplier confirmation') and write through it, avoiding brittle
// direct-BO permission and business-logic pitfalls."
//
// Concretely, what a raw-BO write costs you: POSvc's Update requires the full
// dataset round-trip (GetByID, mutate, Update) with row-state flags set
// correctly, it runs every business-logic directive attached to the BO
// including ones a customer wrote, and it needs BO-level security on an
// account that then has far more authority than it should. An Updatable BAQ
// is a named, versioned contract the customer's own Epicor admin can inspect
// and grant narrowly — which is also what makes it reviewable at a buyer
// whose IT department will absolutely ask.
//
// The cost, stated honestly: these BAQs do not exist until someone deploys
// them. They are ours to ship and the customer's to import, and their ids are
// configurable because a customer with a naming standard will rename them.

export const DEFAULT_BAQS = {
  /** Updatable: writes promise date, agreed qty/price back onto a PO release. */
  purchaseOrderAcknowledgment: "ZS-PO-Ack",
  /**
   * Updatable: creates a requisition line from a buyer's decision on an MRP
   * suggestion. NOT a write to the suggestion — Epicor rejects that outright
   * ("Suggestion is no longer valid"), which is why the decision has to enter
   * through the requisition/approval path instead.
   */
  suggestionDecision: "ZS-PO-Sugg-Decision",
} as const;

export type BaqIds = typeof DEFAULT_BAQS;

export function baqIdsFor(config: EpicorConfig): BaqIds {
  const overrides = (config as unknown as { baqs?: Partial<BaqIds> }).baqs;
  return { ...DEFAULT_BAQS, ...(overrides ?? {}) };
}

/**
 * Push an acknowledgment or an agreed change back onto an Epicor PO.
 *
 * Only ever the fields the supplier actually committed to. A write-back that
 * pushed ZenoSource's whole view of the line would overwrite buyer-side edits
 * made in Epicor since the last sync, and the ERP is the source of truth for
 * the fields it owns (docs/architecture.md#data-boundaries) — we are adding
 * the supplier's answer, not asserting our copy.
 */
export async function pushPurchaseOrderChange(
  client: EpicorClient,
  config: EpicorConfig,
  change: PurchaseOrderWriteBack
): Promise<WriteBackResult> {
  const [poNum, poLine] = splitLineRef(change.lineExternalRef);
  if (!poNum || poLine === undefined) {
    return { ok: false, detail: `Unrecognized line reference "${change.lineExternalRef}".` };
  }

  const payload: Record<string, unknown> = {
    Company: config.company,
    PONum: poNum,
    POLine: poLine,
  };
  if (change.promiseDate !== undefined && change.promiseDate !== null) {
    payload.PromiseDt = change.promiseDate;
  }
  if (change.quantity !== undefined && change.quantity !== null) {
    payload.OrderQty = change.quantity;
  }
  if (change.unitPrice !== undefined && change.unitPrice !== null) {
    payload.UnitCost = change.unitPrice;
  }
  if (change.acknowledged) {
    payload.Acknowledged = true;
  }

  // Nothing but the keys — there is no change to push, and a PATCH carrying
  // only keys would still touch the row's ChangeDate and drag it into the
  // next incremental pull for no reason.
  if (Object.keys(payload).length <= 3) {
    return { ok: true, detail: "Nothing to write back." };
  }

  const baqs = baqIdsFor(config);
  try {
    await client.request(client.baqUrl(baqs.purchaseOrderAcknowledgment), {
      method: "PATCH",
      body: { value: [payload] },
    });
    return { ok: true, externalRef: change.lineExternalRef };
  } catch (error) {
    return { ok: false, detail: describeWriteFailure(error, baqs.purchaseOrderAcknowledgment) };
  }
}

/**
 * Push a buyer's accept/reject of an MRP suggestion into the requisition path.
 *
 * A rejection is recorded rather than sent: Epicor has no "buyer declined
 * this suggestion" state to write to, and the next MRP run will re-propose it
 * regardless. Saying so here, instead of silently returning ok, keeps the
 * platform from telling a buyer their rejection went somewhere it didn't.
 */
export async function pushSuggestionDecision(
  client: EpicorClient,
  config: EpicorConfig,
  decision: SuggestionDecision
): Promise<WriteBackResult> {
  if (decision.decision === "REJECT") {
    return {
      ok: true,
      detail:
        "Recorded in ZenoSource. Epicor has no state for a declined suggestion — MRP will propose it again on its next run unless the underlying demand changes.",
    };
  }

  const [sugNum, sugLine] = splitLineRef(decision.suggestionExternalRef);
  if (!sugNum || sugLine === undefined) {
    return { ok: false, detail: `Unrecognized suggestion reference "${decision.suggestionExternalRef}".` };
  }

  const baqs = baqIdsFor(config);
  const payload: Record<string, unknown> = {
    Company: config.company,
    SugNum: sugNum,
    POLine: sugLine,
    Approve: true,
  };
  if (decision.quantity) payload.OrderQty = decision.quantity;
  if (decision.needByDate) payload.DueDate = decision.needByDate;
  if (decision.reason) payload.CommentText = decision.reason;

  try {
    const result = await client.request<{ value?: { ReqNum?: string | number }[] }>(
      client.baqUrl(baqs.suggestionDecision),
      { method: "PATCH", body: { value: [payload] } }
    );
    const reqNum = result?.value?.[0]?.ReqNum;
    return {
      ok: true,
      externalRef: reqNum === undefined ? undefined : String(reqNum),
      detail: reqNum
        ? `Raised as Epicor requisition ${reqNum}, which still has to clear your approval path there.`
        : "Sent to Epicor's requisition path.",
    };
  } catch (error) {
    return { ok: false, detail: describeWriteFailure(error, baqs.suggestionDecision) };
  }
}

/** `"12345-2"` -> `["12345", 2]`. */
function splitLineRef(ref: string): [string | undefined, number | undefined] {
  const index = ref.lastIndexOf("-");
  if (index <= 0) return [undefined, undefined];
  const head = ref.slice(0, index);
  const tail = Number(ref.slice(index + 1));
  return [head, Number.isInteger(tail) ? tail : undefined];
}

/**
 * A 404 on a BAQ means it isn't deployed on this instance — by far the most
 * likely write-back failure, and one whose generic message ("Epicor returned
 * HTTP 404") would send an admin looking in entirely the wrong place.
 */
function describeWriteFailure(error: unknown, baqId: string): string {
  if (error instanceof EpicorError && error.status === 404) {
    return `Epicor has no BAQ named "${baqId}". ZenoSource writes back through an Updatable BAQ rather than calling business objects directly — import the ZenoSource BAQ package into this environment, or point the connection at your own BAQ's id.`;
  }
  if (error instanceof EpicorError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
