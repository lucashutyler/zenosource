"use client";

import { useActionState } from "react";
import { createSupplier } from "@/app/actions/suppliers";
import { FormErrors, SubmitButton, TextField } from "@/components/forms";
import { Callout, PageHeader } from "@/components/ui";
import { valueFor } from "@/lib/form-state";

export default function NewSupplierPage() {
  const [state, action] = useActionState(createSupplier, undefined);
  const errors = state?.fieldErrors ?? {};

  return (
    <div className="max-w-lg">
      <PageHeader
        back={{ href: "/dashboard/suppliers", label: "All suppliers" }}
        eyebrow="New"
        title="Add a supplier"
      />

      <form action={action}>
        <FormErrors state={state} />

        <TextField
          label="Company name"
          name="name"
          required
          defaultValue={valueFor(state, "name", "")}
          error={errors.name}
        />

        <div className="mb-4">
          <Callout title="Who acknowledges your orders">
            The name and email below become this supplier&apos;s first contact — the person who
            gets the one-tap link and confirms a purchase order. Until one exists, orders to this
            supplier can&apos;t be issued at all, so it&apos;s worth filling in now.
          </Callout>
        </div>

        <TextField
          label="Contact name"
          name="primaryContactName"
          defaultValue={valueFor(state, "primaryContactName", "")}
          error={errors.primaryContactName}
        />
        <TextField
          label="Contact email"
          name="primaryContactEmail"
          type="email"
          autoComplete="off"
          defaultValue={valueFor(state, "primaryContactEmail", "")}
          error={errors.primaryContactEmail}
        />

        <SubmitButton pendingLabel="Saving…">Save supplier</SubmitButton>
      </form>
    </div>
  );
}
