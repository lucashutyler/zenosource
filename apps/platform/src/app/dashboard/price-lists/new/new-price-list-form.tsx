"use client";

import { useActionState } from "react";
import { createPriceList } from "@/app/actions/price-lists";
import { Card, Field, Input, Select, ErrorText, SubmitButton, PageHeader } from "@/components/ui";

export function NewPriceListForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createPriceList, undefined);

  return (
    <div className="max-w-lg">
      <PageHeader title="New price list" />
      <Card className="p-6">
        <form action={action}>
          <Field label="Supplier" name="supplierId">
            <Select name="supplierId" required defaultValue="">
              <option value="" disabled>
                Choose a supplier
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Effective from (optional)" name="effectiveFrom">
            <Input name="effectiveFrom" type="date" />
          </Field>
          <Field label="Effective to (optional)" name="effectiveTo">
            <Input name="effectiveTo" type="date" />
          </Field>
          <ErrorText>{state?.error}</ErrorText>
          <SubmitButton pending={pending}>
            {pending ? "Saving..." : "Save price list"}
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
