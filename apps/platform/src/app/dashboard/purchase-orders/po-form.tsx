"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createPurchaseOrder, updateDraftPurchaseOrder } from "@/app/actions/purchase-orders";
import {
  FormErrors,
  GridInput,
  GridSelect,
  SelectField,
  SubmitButton,
} from "@/components/forms";
import { PageHeader, Panel, Money } from "@/components/ui";
import { formatUnitPrice } from "@/lib/format";

export type LineInitial = {
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

/** A supplier's negotiated schedule, flattened for lookup in the browser. */
export type PriceSchedule = {
  supplierId: string;
  itemNumber: string;
  description: string;
  uom: string;
  listNumber: string;
  breaks: { minQuantity: number; unitPrice: number }[];
};

export function PurchaseOrderForm({
  mode,
  poId,
  suppliers,
  locations,
  schedules,
  initialSupplierId,
  initialLines,
}: {
  mode: "create" | "edit";
  poId?: string;
  suppliers: { id: string; name: string }[];
  locations: { id: string; name: string; code: string }[];
  schedules: PriceSchedule[];
  initialSupplierId?: string;
  initialLines?: LineInitial[];
}) {
  const action =
    mode === "create" ? createPurchaseOrder : updateDraftPurchaseOrder.bind(null, poId!);
  const [state, formAction] = useActionState(action, undefined);

  // Rows are state, not a fixed-length array. `LINE_SLOTS = 5` with parsers
  // reading indices 0–4 silently discarded a sixth line, and would have
  // dropped the tail when editing an order that already had more than five.
  const initialRows =
    initialLines && initialLines.length > 0 ? initialLines : [EMPTY_LINE, EMPTY_LINE, EMPTY_LINE];
  const [rowKeys, setRowKeys] = useState(() => initialRows.map((_, i) => i));
  const [nextKey, setNextKey] = useState(initialRows.length);

  const [supplierId, setSupplierId] = useState(initialSupplierId ?? "");
  const [rows, setRows] = useState<Record<number, LineInitial>>(() =>
    Object.fromEntries(initialRows.map((row, i) => [i, row]))
  );

  const fieldErrors = state?.fieldErrors ?? {};

  function update(key: number, patch: Partial<LineInitial>) {
    setRows((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_LINE), ...patch } }));
  }

  const supplierSchedules = schedules.filter((s) => s.supplierId === supplierId);

  const total = rowKeys.reduce((sum, key) => {
    const row = rows[key] ?? EMPTY_LINE;
    const q = Number(row.quantity);
    const p = Number(row.unitPrice);
    return sum + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
  }, 0);

  return (
    <div className="max-w-6xl">
      <PageHeader
        back={{
          href:
            mode === "edit" && poId
              ? `/dashboard/purchase-orders/${poId}`
              : "/dashboard/purchase-orders",
          label: mode === "edit" ? "Back to the order" : "All purchase orders",
        }}
        eyebrow={mode === "create" ? "New" : "Editing draft"}
        title={mode === "create" ? "Raise a purchase order" : "Edit this draft"}
        meta={
          mode === "create"
            ? "Saving keeps it as a draft. Nothing reaches the supplier until you issue it."
            : "Only drafts can be edited. Once issued, changes go through the propose-and-agree flow."
        }
      />

      <form action={formAction}>
        <FormErrors state={state} />

        <div className="max-w-md">
          <SelectField
            label="Supplier"
            name="supplierId"
            required
            error={fieldErrors.supplierId}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Choose a supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="mb-2 mt-6 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Lines</h2>
          {supplierSchedules.length > 0 && (
            <p className="text-xs text-ink-faint">
              {supplierSchedules.length} priced{" "}
              {supplierSchedules.length === 1 ? "part" : "parts"} on file for this supplier —
              prices fill in as you type a part number and quantity.
            </p>
          )}
        </div>

        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[54rem] text-sm">
            <thead>
              <tr>
                <Th>Item&nbsp;#*</Th>
                <Th>Description*</Th>
                <Th width="5rem">UOM*</Th>
                <Th width="7rem" align="right">Qty*</Th>
                <Th width="9rem" align="right">Unit price*</Th>
                <Th width="11rem">Location*</Th>
                <Th width="9.5rem">Need by</Th>
                <Th width="3rem" />
              </tr>
            </thead>
            <tbody>
              {rowKeys.map((key, position) => (
                <LineRow
                  key={key}
                  index={key}
                  position={position}
                  row={rows[key] ?? EMPTY_LINE}
                  fieldErrors={fieldErrors}
                  locations={locations}
                  schedules={supplierSchedules}
                  onChange={(patch) => update(key, patch)}
                  onRemove={
                    rowKeys.length > 1
                      ? () => {
                          setRowKeys((keys) => keys.filter((k) => k !== key));
                        }
                      : undefined
                  }
                />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="border-t-2 border-ink px-3 py-2.5 text-right font-medium">
                  Order total
                </td>
                <td className="border-t-2 border-ink px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
                  <Money value={total} />
                </td>
                <td colSpan={3} className="border-t-2 border-ink" />
              </tr>
            </tfoot>
          </table>
        </Panel>

        <button
          type="button"
          onClick={() => {
            setRowKeys((keys) => [...keys, nextKey]);
            setRows((prev) => ({ ...prev, [nextKey]: EMPTY_LINE }));
            setNextKey((n) => n + 1);
          }}
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 border border-rule-strong px-3 py-2 text-sm font-medium text-ink hover:bg-rule/40"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add a line
        </button>

        <div className="mt-8 flex items-center gap-3 border-t border-rule pt-5">
          <SubmitButton pendingLabel="Saving…">
            {mode === "create" ? "Save as draft" : "Save changes"}
          </SubmitButton>
          <p className="text-sm text-ink-faint">Nothing is sent yet.</p>
        </div>
      </form>
    </div>
  );
}

function Th({
  children,
  width,
  align = "left",
}: {
  children?: React.ReactNode;
  width?: string;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={`border-b border-rule-strong px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function LineRow({
  index,
  position,
  row,
  fieldErrors,
  locations,
  schedules,
  onChange,
  onRemove,
}: {
  index: number;
  position: number;
  row: LineInitial;
  fieldErrors: Record<string, string>;
  locations: { id: string; name: string; code: string }[];
  schedules: PriceSchedule[];
  onChange: (patch: Partial<LineInitial>) => void;
  onRemove?: () => void;
}) {
  // Controlled from `rows` state rather than `defaultValue`. `useActionState`
  // preserves client state across a failed submit, so nothing the user typed
  // is lost when validation sends the form back — which is the whole point:
  // one missing Location used to destroy roughly 35 filled-in fields.
  const { itemNumber, quantity, unitPrice } = row;

  const schedule = schedules.find(
    (s) => s.itemNumber.toLowerCase() === itemNumber.trim().toLowerCase()
  );

  // The negotiated price *for the quantity actually typed*. Price breaks are
  // quantity-dependent, so pre-filling the base rate would be its own quiet
  // error — the audit found a line saved at $44.00 against a negotiated
  // $8.755 because nothing on the form knew the schedule existed.
  const scheduled = schedule
    ? [...schedule.breaks]
        .filter((b) => b.minQuantity <= (Number(quantity) || 0))
        .sort((a, b) => b.minQuantity - a.minQuantity)[0]
    : undefined;

  const typedPrice = Number(unitPrice);
  const offSchedule =
    scheduled && Number.isFinite(typedPrice) && typedPrice > 0 && typedPrice !== scheduled.unitPrice
      ? ((typedPrice - scheduled.unitPrice) / scheduled.unitPrice) * 100
      : null;

  return (
    <tr className="border-b border-rule align-top">
      <Cell>
        <label htmlFor={`itemNumber-${index}`} className="sr-only">
          Line {position + 1} item number
        </label>
        <GridInput
          name={`itemNumber-${index}`}
          value={itemNumber}
          error={fieldErrors[`itemNumber-${index}`]}
          onChange={(e) => {
            const next = e.target.value;
            onChange({ itemNumber: next });
            const match = schedules.find(
              (s) => s.itemNumber.toLowerCase() === next.trim().toLowerCase()
            );
            if (match) onChange({ description: match.description, uom: match.uom });
          }}
          list={`parts-${index}`}
          autoComplete="off"
          className="font-mono"
        />
        <datalist id={`parts-${index}`}>
          {schedules.map((s) => (
            <option key={s.itemNumber} value={s.itemNumber}>
              {s.description}
            </option>
          ))}
        </datalist>
        <FieldError name={`itemNumber-${index}`} message={fieldErrors[`itemNumber-${index}`]} />
      </Cell>

      <Cell>
        <label htmlFor={`description-${index}`} className="sr-only">
          Line {position + 1} description
        </label>
        <GridInput
          name={`description-${index}`}
          value={row.description}
          onChange={(e) => onChange({ description: e.target.value })}
          error={fieldErrors[`description-${index}`]}
        />
        <FieldError name={`description-${index}`} message={fieldErrors[`description-${index}`]} />
      </Cell>

      <Cell>
        <label htmlFor={`uom-${index}`} className="sr-only">
          Line {position + 1} unit of measure
        </label>
        <GridInput
          name={`uom-${index}`}
          value={row.uom}
          onChange={(e) => onChange({ uom: e.target.value })}
          error={fieldErrors[`uom-${index}`]}
        />
        <FieldError name={`uom-${index}`} message={fieldErrors[`uom-${index}`]} />
      </Cell>

      <Cell>
        <label htmlFor={`quantity-${index}`} className="sr-only">
          Line {position + 1} quantity
        </label>
        <GridInput
          name={`quantity-${index}`}
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={row.quantity}
          onChange={(e) => {
            const next = e.target.value;
            onChange({ quantity: next });
            // Re-price on quantity change: crossing a break boundary is
            // exactly when the negotiated rate changes, and it's the moment a
            // buyer is least likely to remember to check.
            const match = schedules.find(
              (s) => s.itemNumber.toLowerCase() === itemNumber.trim().toLowerCase()
            );
            const band = match
              ? [...match.breaks]
                  .filter((b) => b.minQuantity <= (Number(next) || 0))
                  .sort((a, b) => b.minQuantity - a.minQuantity)[0]
              : undefined;
            if (band) onChange({ unitPrice: String(band.unitPrice) });
          }}
          error={fieldErrors[`quantity-${index}`]}
          className="text-right font-mono"
        />
        <FieldError name={`quantity-${index}`} message={fieldErrors[`quantity-${index}`]} />
      </Cell>

      <Cell>
        <label htmlFor={`unitPrice-${index}`} className="sr-only">
          Line {position + 1} unit price
        </label>
        <GridInput
          name={`unitPrice-${index}`}
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={row.unitPrice}
          onChange={(e) => onChange({ unitPrice: e.target.value })}
          error={fieldErrors[`unitPrice-${index}`]}
          className="text-right font-mono"
        />
        {scheduled && offSchedule === null && (
          <p className="mt-1 text-[11px] text-settled">
            {formatUnitPrice(scheduled.unitPrice)} from schedule {schedule!.listNumber}
          </p>
        )}
        {offSchedule !== null && (
          <p className="mt-1 text-[11px] font-medium text-age-3">
            off schedule {offSchedule > 0 ? "+" : ""}
            {offSchedule.toFixed(0)}% · {schedule!.listNumber} says{" "}
            {formatUnitPrice(scheduled!.unitPrice)}
          </p>
        )}
        <FieldError name={`unitPrice-${index}`} message={fieldErrors[`unitPrice-${index}`]} />
      </Cell>

      <Cell>
        <label htmlFor={`locationId-${index}`} className="sr-only">
          Line {position + 1} location
        </label>
        <GridSelect
          name={`locationId-${index}`}
          value={row.locationId}
          onChange={(e) => onChange({ locationId: e.target.value })}
          error={fieldErrors[`locationId-${index}`]}
        >
          <option value="">Choose…</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.code})
            </option>
          ))}
        </GridSelect>
        <FieldError name={`locationId-${index}`} message={fieldErrors[`locationId-${index}`]} />
      </Cell>

      <Cell>
        <label htmlFor={`needByDate-${index}`} className="sr-only">
          Line {position + 1} need-by date
        </label>
        <GridInput
          name={`needByDate-${index}`}
          type="date"
          value={row.needByDate}
          onChange={(e) => onChange({ needByDate: e.target.value })}
          error={fieldErrors[`needByDate-${index}`]}
        />
        <FieldError name={`needByDate-${index}`} message={fieldErrors[`needByDate-${index}`]} />
      </Cell>

      <Cell>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove line ${position + 1}`}
            className="flex h-11 w-11 items-center justify-center text-ink-faint hover:text-age-4"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
      </Cell>
    </tr>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-2">{children}</td>;
}

function FieldError({ name, message }: { name: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${name}-error`} role="alert" className="mt-1 text-[11px] font-medium text-age-4">
      {message}
    </p>
  );
}
