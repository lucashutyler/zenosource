"use client";

import { useActionState } from "react";
import { decideSuggestion, type FormActionState } from "@/app/actions/integrations";
import { SubmitButton } from "@/components/forms";
import { ErrorText } from "@/components/ui";

/**
 * Accept or dismiss, per row.
 *
 * Accept carries the quantity and date forward as hidden values rather than
 * as inputs. Editing what MRP proposed is a real need, but it belongs on a
 * detail view with the demand behind it visible — an editable quantity in a
 * ledger row invites a buyer to change a number they can't see the reasoning
 * for. The action already accepts both, so that view is additive.
 */
export function SuggestionDecision({
  suggestionId,
  itemNumber,
  supplierName,
  quantity,
  needByDate,
}: {
  suggestionId: string;
  itemNumber: string;
  supplierName: string;
  quantity: number;
  needByDate: string;
}) {
  const [state, formAction] = useActionState<FormActionState, FormData>(decideSuggestion, undefined);

  if (state?.ok) {
    return <p className="text-xs text-ink-soft">{state.ok}</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <form action={formAction}>
          <input type="hidden" name="suggestionId" value={suggestionId} />
          <input type="hidden" name="decision" value="ACCEPT" />
          <input type="hidden" name="quantity" value={quantity.toFixed(4)} />
          <input type="hidden" name="needByDate" value={needByDate} />
          <SubmitButton variant="primary" pendingLabel="Sending…">
            <span aria-hidden>Raise in Epicor</span>
            <span className="sr-only">
              Raise a requisition in Epicor for {quantity} {itemNumber} from {supplierName}
            </span>
          </SubmitButton>
        </form>
        <form action={formAction}>
          <input type="hidden" name="suggestionId" value={suggestionId} />
          <input type="hidden" name="decision" value="REJECT" />
          <SubmitButton variant="quiet" pendingLabel="Dismissing…">
            <span aria-hidden>Dismiss</span>
            <span className="sr-only">
              Dismiss the suggestion for {itemNumber} from {supplierName}
            </span>
          </SubmitButton>
        </form>
      </div>
      {state?.error && <ErrorText>{state.error}</ErrorText>}
    </div>
  );
}
