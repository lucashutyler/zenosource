"use client";

import { useActionState } from "react";
import { createLocation } from "@/app/actions/locations";
import { Card, Field, Input, ErrorText, SubmitButton, PageHeader } from "@/components/ui";

export default function NewLocationPage() {
  const [state, action, pending] = useActionState(createLocation, undefined);

  return (
    <div className="max-w-lg">
      <PageHeader title="Add location" />
      <Card className="p-6">
        <form action={action}>
          <Field label="Name" name="name">
            <Input name="name" required placeholder="Chicago Plant" />
          </Field>
          <Field label="Code" name="code">
            <Input name="code" required placeholder="CHI-01" />
          </Field>
          <Field label="City" name="city">
            <Input name="city" />
          </Field>
          <Field label="Region / State" name="region">
            <Input name="region" />
          </Field>
          <Field label="Country" name="country">
            <Input name="country" />
          </Field>
          <ErrorText>{state?.error}</ErrorText>
          <SubmitButton pending={pending}>
            {pending ? "Saving..." : "Save location"}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
