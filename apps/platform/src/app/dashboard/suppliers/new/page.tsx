"use client";

import { useActionState } from "react";
import { createSupplier } from "@/app/actions/suppliers";
import { Card, Field, Input, ErrorText, SubmitButton, PageHeader } from "@/components/ui";

export default function NewSupplierPage() {
  const [state, action, pending] = useActionState(createSupplier, undefined);

  return (
    <div className="max-w-lg">
      <PageHeader title="Add supplier" />
      <Card className="p-6">
        <form action={action}>
          <Field label="Name" name="name">
            <Input name="name" required />
          </Field>
          <Field label="Primary contact name" name="primaryContactName">
            <Input name="primaryContactName" />
          </Field>
          <Field label="Primary contact email" name="primaryContactEmail">
            <Input name="primaryContactEmail" type="email" />
          </Field>
          <ErrorText>{state?.error}</ErrorText>
          <SubmitButton pending={pending}>
            {pending ? "Saving..." : "Save supplier"}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
