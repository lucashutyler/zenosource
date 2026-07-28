"use client";

import { useActionState } from "react";
import { addPriceListItem } from "@/app/actions/price-lists";
import { Field, Input, ErrorText, SubmitButton } from "@/components/ui";

export function AddItemForm({ priceListId }: { priceListId: string }) {
  const boundAction = addPriceListItem.bind(null, priceListId);
  const [state, action, pending] = useActionState(boundAction, undefined);

  return (
    <form action={action} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Field label="Item #" name="itemNumber">
        <Input name="itemNumber" required />
      </Field>
      <Field label="Description" name="description">
        <Input name="description" required />
      </Field>
      <Field label="UOM" name="uom">
        <Input name="uom" required defaultValue="EA" />
      </Field>
      <Field label="Min quantity" name="minQuantity">
        <Input name="minQuantity" type="number" step="1" min="0" required defaultValue="1" />
      </Field>
      <Field label="Unit price" name="unitPrice">
        <Input name="unitPrice" type="number" step="any" min="0" required />
      </Field>
      <div className="mb-4 flex items-end">
        <SubmitButton pending={pending}>{pending ? "Adding..." : "Add item"}</SubmitButton>
      </div>
      <div className="col-span-full">
        <ErrorText>{state?.error}</ErrorText>
      </div>
    </form>
  );
}
