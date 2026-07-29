"use client";

import { useActionState } from "react";
import { closePurchaseOrder } from "@/app/actions/purchase-orders";
import { ConfirmSubmit } from "@/components/forms";
import { ErrorText } from "@/components/ui";

/**
 * Closing out a fully received order — the last owned action in a PO's life,
 * and the one that finally lets it stop being chased.
 */
export function CloseForm({ poId, number }: { poId: string; number: string }) {
  const [state, action] = useActionState(closePurchaseOrder.bind(null, poId), undefined);

  return (
    <form action={action}>
      <ConfirmSubmit
        trigger="Close it out"
        variant="primary"
        confirmVariant="primary"
        title={`Close ${number}?`}
        body="Everything ordered has been received. Closing settles the order — no further action from either side, and it drops off the board for good."
        confirmLabel="Close it"
      />
      <ErrorText>{state?.error}</ErrorText>
    </form>
  );
}
