"use client";

import { useActionState } from "react";
import { addPriceListItem } from "@/app/actions/price-lists";
import { FormErrors, SubmitButton, TextField } from "@/components/forms";

export function AddItemForm({ priceListId }: { priceListId: string }) {
  const [state, action] = useActionState(addPriceListItem.bind(null, priceListId), undefined);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action}>
      <FormErrors state={state} />
      <div className="grid gap-x-4 sm:grid-cols-3">
        <TextField
          label="Part number"
          name="itemNumber"
          required
          error={errors.itemNumber}
          className="font-mono"
        />
        <TextField label="Description" name="description" required error={errors.description} />
        <TextField label="Unit of measure" name="uom" required defaultValue="EA" error={errors.uom} />
        <TextField
          label="From quantity"
          name="minQuantity"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          required
          defaultValue="1"
          hint="The first band. Add more afterwards."
          error={errors.minQuantity}
        />
        <TextField
          label="Price each"
          name="unitPrice"
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          required
          hint="USD. Up to four decimals."
          error={errors.unitPrice}
        />
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Adding…">Add the part</SubmitButton>
        {state?.ok && (
          <span role="status" className="text-sm text-settled">
            {state.ok}
          </span>
        )}
      </div>
    </form>
  );
}
