"use client";

import { useActionState } from "react";
import { addPriceBreak } from "@/app/actions/price-lists";
import { GridInput, SubmitButton } from "@/components/forms";

export function AddPriceBreakForm({ itemId }: { itemId: string }) {
  const [state, action] = useActionState(addPriceBreak.bind(null, itemId), undefined);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="w-28">
        <label
          htmlFor={`minQuantity-${itemId}`}
          className="mb-1 block text-[11px] uppercase tracking-wider text-ink-faint"
        >
          From qty
        </label>
        <GridInput
          name="minQuantity"
          id={`minQuantity-${itemId}`}
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          required
          error={errors.minQuantity}
          className="text-right font-mono"
        />
      </div>
      <div className="w-32">
        <label
          htmlFor={`unitPrice-${itemId}`}
          className="mb-1 block text-[11px] uppercase tracking-wider text-ink-faint"
        >
          Price each
        </label>
        <GridInput
          name="unitPrice"
          id={`unitPrice-${itemId}`}
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          required
          error={errors.unitPrice}
          className="text-right font-mono"
        />
      </div>
      <SubmitButton variant="secondary" pendingLabel="Adding…">
        Add band
      </SubmitButton>
      {(state?.error || errors.minQuantity || errors.unitPrice) && (
        <p role="alert" className="basis-full text-xs font-medium text-age-4">
          {errors.minQuantity ?? errors.unitPrice ?? state?.error}
        </p>
      )}
    </form>
  );
}
