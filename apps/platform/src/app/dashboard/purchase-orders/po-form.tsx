"use client";

import { useActionState } from "react";
import { createPurchaseOrder, updateDraftPurchaseOrder } from "@/app/actions/purchase-orders";
import { Card, Field, Input, Select, ErrorText, SubmitButton, PageHeader } from "@/components/ui";

type LineInitial = {
  itemNumber: string;
  description: string;
  uom: string;
  quantity: string;
  unitPrice: string;
  locationId: string;
  needByDate: string;
};

const EMPTY_LINE: LineInitial = {
  itemNumber: "",
  description: "",
  uom: "EA",
  quantity: "",
  unitPrice: "",
  locationId: "",
  needByDate: "",
};

const LINE_SLOTS = 5;

export function PurchaseOrderForm({
  mode,
  poId,
  suppliers,
  locations,
  initialSupplierId,
  initialLines,
}: {
  mode: "create" | "edit";
  poId?: string;
  suppliers: { id: string; name: string }[];
  locations: { id: string; name: string; code: string }[];
  initialSupplierId?: string;
  initialLines?: LineInitial[];
}) {
  const action = mode === "create" ? createPurchaseOrder : updateDraftPurchaseOrder.bind(null, poId!);
  const [state, formAction, pending] = useActionState(action, undefined);

  const rows = Array.from({ length: LINE_SLOTS }, (_, i) => initialLines?.[i] ?? EMPTY_LINE);

  return (
    <div className="max-w-4xl">
      <PageHeader title={mode === "create" ? "New purchase order" : "Edit draft"} />
      <Card className="p-6">
        <form action={formAction}>
          <Field label="Supplier" name="supplierId">
            <Select name="supplierId" required defaultValue={initialSupplierId ?? ""}>
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

          <h2 className="mb-2 mt-6 text-sm font-medium text-zinc-950 dark:text-zinc-50">
            Lines
          </h2>
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
                <Field label="Unit price" name={`unitPrice-${i}`}>
                  <Input name={`unitPrice-${i}`} type="number" step="any" defaultValue={row.unitPrice} />
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

          <div className="mt-6">
            <ErrorText>{state?.error}</ErrorText>
            <SubmitButton pending={pending}>
              {pending ? "Saving..." : mode === "create" ? "Save draft" : "Save changes"}
            </SubmitButton>
          </div>
        </form>
      </Card>
    </div>
  );
}
