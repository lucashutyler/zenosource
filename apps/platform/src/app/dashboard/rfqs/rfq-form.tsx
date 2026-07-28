"use client";

import { useActionState } from "react";
import { createRFQ } from "@/app/actions/rfqs";
import { Card, Field, Input, Select, ErrorText, SubmitButton, PageHeader } from "@/components/ui";

const LINE_SLOTS = 5;

const EMPTY_LINE = {
  itemNumber: "",
  description: "",
  uom: "EA",
  quantity: "",
  locationId: "",
  needByDate: "",
};

export function RFQForm({
  suppliers,
  locations,
}: {
  suppliers: { id: string; name: string }[];
  locations: { id: string; name: string; code: string }[];
}) {
  const [state, formAction, pending] = useActionState(createRFQ, undefined);

  const rows = Array.from({ length: LINE_SLOTS }, () => EMPTY_LINE);

  return (
    <div className="max-w-4xl">
      <PageHeader title="New RFQ" />
      <Card className="p-6">
        <form action={formAction}>
          <h2 className="mb-2 text-sm font-medium text-zinc-950 dark:text-zinc-50">Lines</h2>
          <p className="mb-4 text-xs text-zinc-500">
            Leave the item number blank to skip a row. Up to {LINE_SLOTS} lines.
          </p>

          <div className="space-y-4">
            {rows.map((row, i) => (
              <div
                key={i}
                className="grid grid-cols-2 gap-3 rounded-md border border-zinc-200 p-3 sm:grid-cols-4 dark:border-zinc-800"
              >
                <Field label="Item #" name={`itemNumber-${i}`}>
                  <Input name={`itemNumber-${i}`} defaultValue={row.itemNumber} />
                </Field>
                <Field label="Description" name={`description-${i}`}>
                  <Input name={`description-${i}`} defaultValue={row.description} />
                </Field>
                <Field label="UOM" name={`uom-${i}`}>
                  <Input name={`uom-${i}`} defaultValue={row.uom} />
                </Field>
                <Field label="Qty" name={`quantity-${i}`}>
                  <Input name={`quantity-${i}`} type="number" step="any" defaultValue={row.quantity} />
                </Field>
                <Field label="Location" name={`locationId-${i}`}>
                  <Select name={`locationId-${i}`} defaultValue={row.locationId}>
                    <option value="">—</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.code})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Need by" name={`needByDate-${i}`}>
                  <Input name={`needByDate-${i}`} type="date" defaultValue={row.needByDate} />
                </Field>
              </div>
            ))}
          </div>

          <h2 className="mb-2 mt-6 text-sm font-medium text-zinc-950 dark:text-zinc-50">
            Invite suppliers
          </h2>
          <p className="mb-4 text-xs text-zinc-500">
            Check suppliers to invite now — this sends the RFQ immediately. Leave all unchecked to
            save as a draft.
          </p>
          <div className="mb-6 space-y-2">
            {suppliers.length === 0 ? (
              <p className="text-sm text-zinc-500">No suppliers yet.</p>
            ) : (
              suppliers.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-sm text-zinc-900 dark:text-zinc-100"
                >
                  <input
                    type="checkbox"
                    name="supplierIds"
                    value={s.id}
                    className="rounded border-zinc-300 dark:border-zinc-700"
                  />
                  {s.name}
                </label>
              ))
            )}
          </div>

          <ErrorText>{state?.error}</ErrorText>
          <SubmitButton pending={pending}>{pending ? "Saving..." : "Save RFQ"}</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
