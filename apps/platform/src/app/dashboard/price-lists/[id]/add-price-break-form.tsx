"use client";

import { useActionState } from "react";
import { addPriceBreak } from "@/app/actions/price-lists";
import { Field, Input, ErrorText, SubmitButton } from "@/components/ui";

export function AddPriceBreakForm({ itemId }: { itemId: string }) {
  const boundAction = addPriceBreak.bind(null, itemId);
  const [state, action, pending] = useActionState(boundAction, undefined);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="w-24">
        <Field label="Min qty" name="minQuantity">
          <Input name="minQuantity" type="number" step="1" min="0" required />
        </Field>
      </div>
      <div className="w-28">
        <Field label="Unit price" name="unitPrice">
          <Input name="unitPrice" type="number" step="any" min="0" required />
        </Field>
      </div>
      <div className="mb-4">
        <SubmitButton pending={pending} variant="secondary">
          {pending ? "Adding..." : "Add break"}
        </SubmitButton>
      </div>
      <div className="basis-full">
        <ErrorText>{state?.error}</ErrorText>
      </div>
    </form>
  );
}
