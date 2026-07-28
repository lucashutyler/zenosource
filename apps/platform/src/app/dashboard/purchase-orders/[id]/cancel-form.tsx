"use client";

import { useActionState } from "react";
import { cancelPurchaseOrder } from "@/app/actions/purchase-orders";
import { Field, Input, ErrorText, SubmitButton } from "@/components/ui";

export function CancelForm({ poId }: { poId: string }) {
  const boundAction = cancelPurchaseOrder.bind(null, poId);
  const [state, action, pending] = useActionState(boundAction, undefined);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex-1">
        <Field label="Cancellation reason (optional)" name="reason">
          <Input name="reason" />
        </Field>
      </div>
      <div className="mb-4">
        <SubmitButton pending={pending} variant="danger">
          {pending ? "Cancelling..." : "Cancel PO"}
        </SubmitButton>
      </div>
      <div className="basis-full">
        <ErrorText>{state?.error}</ErrorText>
      </div>
    </form>
  );
}
