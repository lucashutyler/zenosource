"use client";

import { useActionState } from "react";
import { cancelPurchaseOrder } from "@/app/actions/purchase-orders";
import { ConfirmSubmit, TextAreaField } from "@/components/forms";
import { ErrorText } from "@/components/ui";

/**
 * `Cancel PO` used to be a solid red button sitting permanently on the page,
 * firing on one click with no confirmation and no pending state.
 *
 * It is wrong 99% of the times it is looked at, and rendering it in the
 * loudest colour available teaches people to ignore red — which is the same
 * colour the age ramp uses for a fortnight-old unanswered order. Under the
 * spine, a destructive action is quiet text and the colour lives in the
 * confirm, where it's actually load-bearing.
 */
export function CancelForm({
  poId,
  number,
  supplierName,
  status,
}: {
  poId: string;
  number: string;
  supplierName: string;
  status: string;
}) {
  const [state, action] = useActionState(cancelPurchaseOrder.bind(null, poId), undefined);
  const alreadySeen = status !== "DRAFT";

  return (
    <form action={action}>
      <ConfirmSubmit
        trigger="Cancel this order"
        variant="quiet"
        confirmVariant="primary"
        title={`Cancel ${number}?`}
        body={
          <>
            {alreadySeen ? (
              <>
                {supplierName} has already seen this order. Cancelling closes every open line and
                stops the chase — it does not un-send it, so tell them why.
              </>
            ) : (
              <>
                Nothing has been sent yet. Cancelling keeps {number} in the ledger permanently as a
                cancelled order; if it was raised by mistake, delete the draft instead.
              </>
            )}
          </>
        }
        confirmLabel="Cancel the order"
      >
        <TextAreaField
          label="Why"
          name="reason"
          optional
          rows={2}
          hint="Goes on the record and into the supplier's copy."
        />
      </ConfirmSubmit>
      <ErrorText>{state?.error}</ErrorText>
    </form>
  );
}
