"use client";

import { useActionState } from "react";
import { issuePurchaseOrder } from "@/app/actions/purchase-orders";
import { ErrorText, SubmitButton } from "@/components/ui";

export function IssueForm({ poId }: { poId: string }) {
  const boundAction = issuePurchaseOrder.bind(null, poId);
  const [state, action, pending] = useActionState(boundAction, undefined);

  return (
    <form action={action}>
      <SubmitButton pending={pending}>{pending ? "Issuing..." : "Issue to supplier"}</SubmitButton>
      <ErrorText>{state?.error}</ErrorText>
    </form>
  );
}
