"use client";

import { useActionState } from "react";
import { createPriceList } from "@/app/actions/price-lists";
import { FormErrors, SelectField, SubmitButton, TextField } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { valueFor } from "@/lib/form-state";

export function NewPriceListForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const [state, action] = useActionState(createPriceList, undefined);
  const errors = state?.fieldErrors ?? {};

  return (
    <div className="max-w-lg">
      <PageHeader
        back={{ href: "/dashboard/price-lists", label: "All price lists" }}
        eyebrow="New"
        title="New price list"
        meta="Create the schedule first, then add parts and their quantity breaks."
      />

      <form action={action}>
        <FormErrors state={state} />

        <SelectField
          label="Supplier"
          name="supplierId"
          required
          defaultValue={valueFor(state, "supplierId", "")}
          error={errors.supplierId}
        >
          <option value="">Choose a supplier</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <TextField
            label="In force from"
            name="effectiveFrom"
            type="date"
            optional
            defaultValue={valueFor(state, "effectiveFrom", "")}
            error={errors.effectiveFrom}
          />
          <TextField
            label="Until"
            name="effectiveTo"
            type="date"
            optional
            hint="Leave blank for open-ended."
            defaultValue={valueFor(state, "effectiveTo", "")}
            error={errors.effectiveTo}
          />
        </div>

        <SubmitButton pendingLabel="Saving…">Create the list</SubmitButton>
      </form>
    </div>
  );
}
