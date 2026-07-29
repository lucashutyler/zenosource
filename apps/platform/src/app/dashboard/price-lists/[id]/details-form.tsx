"use client";

import { useActionState } from "react";
import { updatePriceList } from "@/app/actions/price-lists";
import { FormErrors, SelectField, SubmitButton, TextField } from "@/components/forms";
import { Panel } from "@/components/ui";
import { valueFor } from "@/lib/form-state";
import { toDateInputValue } from "@/lib/format";

/**
 * Effective dates, editable — and validated so `from` can't be after `to`.
 *
 * The create form accepted a reversed range without comment, producing a
 * schedule that could never apply to anything and gave no indication why the
 * prices it holds never turn up on an order line.
 */
export function PriceListDetailsForm({
  priceList,
  suppliers,
}: {
  priceList: {
    id: string;
    supplierId: string;
    effectiveFrom: Date | null;
    effectiveTo: Date | null;
  };
  suppliers: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(updatePriceList.bind(null, priceList.id), undefined);
  const errors = state?.fieldErrors ?? {};

  return (
    <Panel className="p-4">
      <form action={action}>
        <FormErrors state={state} />
        <div className="grid gap-x-4 sm:grid-cols-3">
          <SelectField
            label="Supplier"
            name="supplierId"
            required
            defaultValue={valueFor(state, "supplierId", priceList.supplierId)}
            error={errors.supplierId}
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="In force from"
            name="effectiveFrom"
            type="date"
            optional
            defaultValue={valueFor(
              state,
              "effectiveFrom",
              toDateInputValue(priceList.effectiveFrom)
            )}
            error={errors.effectiveFrom}
          />
          <TextField
            label="Until"
            name="effectiveTo"
            type="date"
            optional
            defaultValue={valueFor(state, "effectiveTo", toDateInputValue(priceList.effectiveTo))}
            error={errors.effectiveTo}
          />
        </div>
        <div className="flex items-center gap-3">
          <SubmitButton variant="secondary" pendingLabel="Saving…">
            Save
          </SubmitButton>
          {state?.ok && (
            <span role="status" className="text-sm text-settled">
              {state.ok}
            </span>
          )}
        </div>
      </form>
    </Panel>
  );
}
