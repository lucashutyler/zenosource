"use client";

import { useActionState } from "react";
import { addSupplierContact } from "@/app/actions/suppliers";
import { Field, Input, ErrorText, SubmitButton } from "@/components/ui";

export function AddContactForm({ supplierId }: { supplierId: string }) {
  const boundAction = addSupplierContact.bind(null, supplierId);
  const [state, action, pending] = useActionState(boundAction, undefined);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3 border-t border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex-1">
        <Field label="Contact name" name="name">
          <Input name="name" required />
        </Field>
      </div>
      <div className="flex-1">
        <Field label="Contact email" name="email">
          <Input name="email" type="email" required />
        </Field>
      </div>
      <div className="mb-4">
        <SubmitButton pending={pending} variant="secondary">
          {pending ? "Adding..." : "Add contact"}
        </SubmitButton>
      </div>
      <div className="basis-full">
        <ErrorText>{state?.error}</ErrorText>
      </div>
    </form>
  );
}
