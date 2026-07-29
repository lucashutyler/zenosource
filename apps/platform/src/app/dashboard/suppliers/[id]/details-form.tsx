"use client";

import { useActionState } from "react";
import { updateSupplier } from "@/app/actions/suppliers";
import { FormErrors, SubmitButton, TextField } from "@/components/forms";
import { Panel } from "@/components/ui";
import { valueFor } from "@/lib/form-state";

/**
 * Editing a supplier — which was impossible. Suppliers were append-only, so a
 * typo in a company name was permanent and visible on every order that
 * company ever received.
 */
export function SupplierDetailsForm({
  supplier,
}: {
  supplier: {
    id: string;
    name: string;
    primaryContactName: string | null;
    primaryContactEmail: string | null;
  };
}) {
  const [state, action] = useActionState(updateSupplier.bind(null, supplier.id), undefined);
  const errors = state?.fieldErrors ?? {};

  return (
    <Panel className="p-4">
      <form action={action}>
        <FormErrors state={state} />
        <div className="grid gap-x-4 sm:grid-cols-3">
          <TextField
            label="Company name"
            name="name"
            required
            defaultValue={valueFor(state, "name", supplier.name)}
            error={errors.name}
          />
          <TextField
            label="Main contact name"
            name="primaryContactName"
            optional
            defaultValue={valueFor(state, "primaryContactName", supplier.primaryContactName)}
            error={errors.primaryContactName}
          />
          <TextField
            label="Main contact email"
            name="primaryContactEmail"
            type="email"
            optional
            defaultValue={valueFor(state, "primaryContactEmail", supplier.primaryContactEmail)}
            error={errors.primaryContactEmail}
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
