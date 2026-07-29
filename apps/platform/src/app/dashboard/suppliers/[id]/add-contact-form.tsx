"use client";

import { useActionState } from "react";
import { addSupplierContact } from "@/app/actions/suppliers";
import { SubmitButton, TextField } from "@/components/forms";

export function AddContactForm({ supplierId }: { supplierId: string }) {
  const [state, action] = useActionState(addSupplierContact.bind(null, supplierId), undefined);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-wrap items-start gap-3 bg-paper px-4 py-3">
      <div className="min-w-40 flex-1">
        <TextField
          label="New contact"
          name="name"
          required
          placeholder="Name"
          error={errors.name}
          className="mb-0"
        />
      </div>
      <div className="min-w-52 flex-1">
        <TextField
          label="Email"
          name="email"
          type="email"
          required
          placeholder="name@supplier.com"
          error={errors.email}
          className="mb-0"
        />
      </div>
      <div className="pt-6">
        <SubmitButton variant="secondary" pendingLabel="Adding…">
          Add
        </SubmitButton>
      </div>
      {state?.error && !Object.keys(errors).length && (
        <p role="alert" className="basis-full text-xs font-medium text-age-4">
          {state.error}
        </p>
      )}
    </form>
  );
}
