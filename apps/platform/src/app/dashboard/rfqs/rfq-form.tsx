"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createRFQ } from "@/app/actions/rfqs";
import { FormErrors, GridInput, GridSelect, SubmitButton, ConfirmSubmit } from "@/components/forms";
import { PageHeader, Panel } from "@/components/ui";
import { plural } from "@/lib/format";

type Row = {
  itemNumber: string;
  description: string;
  uom: string;
  quantity: string;
  locationId: string;
  needByDate: string;
};

const EMPTY_LINE: Row = {
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
  suppliers: { id: string; name: string; contactCount: number }[];
  locations: { id: string; name: string; code: string }[];
}) {
  const [state, formAction] = useActionState(createRFQ, undefined);
  const [rowKeys, setRowKeys] = useState([0, 1, 2]);
  const [nextKey, setNextKey] = useState(3);
  const [rows, setRows] = useState<Record<number, Row>>({
    0: EMPTY_LINE,
    1: EMPTY_LINE,
    2: EMPTY_LINE,
  });
  const [selected, setSelected] = useState<string[]>([]);

  const fieldErrors = state?.fieldErrors ?? {};

  function update(key: number, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_LINE), ...patch } }));
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        back={{ href: "/dashboard/rfqs", label: "All RFQs" }}
        eyebrow="New"
        title="Ask suppliers for a price"
        meta="Pick suppliers to send to now, or leave them all unticked to keep it as a draft."
      />

      <form action={formAction}>
        <FormErrors state={state} />

        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
          What you need priced
        </h2>

        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr>
                <Th>Item&nbsp;#*</Th>
                <Th>Description*</Th>
                <Th width="5rem">UOM*</Th>
                <Th width="7rem" align="right">Qty*</Th>
                <Th width="11rem">Location</Th>
                <Th width="9.5rem">Need by</Th>
                <Th width="3rem" />
              </tr>
            </thead>
            <tbody>
              {rowKeys.map((key, position) => {
                const row = rows[key] ?? EMPTY_LINE;
                return (
                  <tr key={key} className="border-b border-rule align-top">
                    <Cell>
                      <label htmlFor={`itemNumber-${key}`} className="sr-only">
                        Line {position + 1} item number
                      </label>
                      <GridInput
                        name={`itemNumber-${key}`}
                        value={row.itemNumber}
                        onChange={(e) => update(key, { itemNumber: e.target.value })}
                        error={fieldErrors[`itemNumber-${key}`]}
                        className="font-mono"
                      />
                      <FieldError message={fieldErrors[`itemNumber-${key}`]} name={`itemNumber-${key}`} />
                    </Cell>
                    <Cell>
                      <label htmlFor={`description-${key}`} className="sr-only">
                        Line {position + 1} description
                      </label>
                      <GridInput
                        name={`description-${key}`}
                        value={row.description}
                        onChange={(e) => update(key, { description: e.target.value })}
                        error={fieldErrors[`description-${key}`]}
                      />
                      <FieldError message={fieldErrors[`description-${key}`]} name={`description-${key}`} />
                    </Cell>
                    <Cell>
                      <label htmlFor={`uom-${key}`} className="sr-only">
                        Line {position + 1} unit of measure
                      </label>
                      <GridInput
                        name={`uom-${key}`}
                        value={row.uom}
                        onChange={(e) => update(key, { uom: e.target.value })}
                        error={fieldErrors[`uom-${key}`]}
                      />
                      <FieldError message={fieldErrors[`uom-${key}`]} name={`uom-${key}`} />
                    </Cell>
                    <Cell>
                      <label htmlFor={`quantity-${key}`} className="sr-only">
                        Line {position + 1} quantity
                      </label>
                      <GridInput
                        name={`quantity-${key}`}
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={row.quantity}
                        onChange={(e) => update(key, { quantity: e.target.value })}
                        error={fieldErrors[`quantity-${key}`]}
                        className="text-right font-mono"
                      />
                      <FieldError message={fieldErrors[`quantity-${key}`]} name={`quantity-${key}`} />
                    </Cell>
                    <Cell>
                      <label htmlFor={`locationId-${key}`} className="sr-only">
                        Line {position + 1} location
                      </label>
                      <GridSelect
                        name={`locationId-${key}`}
                        value={row.locationId}
                        onChange={(e) => update(key, { locationId: e.target.value })}
                        error={fieldErrors[`locationId-${key}`]}
                      >
                        <option value="">Any</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name} ({l.code})
                          </option>
                        ))}
                      </GridSelect>
                      <FieldError message={fieldErrors[`locationId-${key}`]} name={`locationId-${key}`} />
                    </Cell>
                    <Cell>
                      <label htmlFor={`needByDate-${key}`} className="sr-only">
                        Line {position + 1} need-by date
                      </label>
                      <GridInput
                        name={`needByDate-${key}`}
                        type="date"
                        value={row.needByDate}
                        onChange={(e) => update(key, { needByDate: e.target.value })}
                        error={fieldErrors[`needByDate-${key}`]}
                      />
                      <FieldError message={fieldErrors[`needByDate-${key}`]} name={`needByDate-${key}`} />
                    </Cell>
                    <Cell>
                      {rowKeys.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setRowKeys((keys) => keys.filter((k) => k !== key))}
                          aria-label={`Remove line ${position + 1}`}
                          className="flex h-11 w-11 items-center justify-center text-ink-faint hover:text-age-4"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      )}
                    </Cell>
                  </tr>
                );
              })}
            </tbody>
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

        <div className="mt-8 max-w-sm">
          <label
            htmlFor="quoteDeadline"
            className="mb-1 block text-sm font-medium text-ink"
          >
            Quotes due by
            <span className="ml-1 font-normal text-ink-faint">(optional)</span>
          </label>
          <input
            id="quoteDeadline"
            name="quoteDeadline"
            type="date"
            aria-describedby="quoteDeadline-hint"
            className="min-h-11 w-full border border-rule-strong bg-paper-raised px-3 py-2 text-sm text-ink"
          />
          <p id="quoteDeadline-hint" className="mt-1 text-xs text-ink-faint">
            Without a date the response window is open-ended and there&apos;s nothing to escalate
            against.
          </p>
        </div>

        <h2 className="mb-2 mt-8 text-xs font-semibold uppercase tracking-wider text-ink-faint">
          Who to ask
        </h2>
        <Panel className="divide-y divide-rule">
          {suppliers.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-faint">
              No suppliers on file. Add one before asking for a quote.
            </p>
          ) : (
            suppliers.map((s) => {
              const reachable = s.contactCount > 0;
              return (
                <label
                  key={s.id}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2.5 text-sm ${
                    reachable ? "text-ink hover:bg-rule/30" : "cursor-not-allowed text-ink-faint"
                  }`}
                >
                  {/* 20px, not the browser default 13px. The audit measured
                      the original at 13x13 — under half the 24px minimum, on
                      the control that decides whether three companies get
                      emailed. */}
                  <input
                    type="checkbox"
                    name="supplierIds"
                    value={s.id}
                    disabled={!reachable}
                    checked={selected.includes(s.id)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                      )
                    }
                    className="h-5 w-5 shrink-0 border-rule-strong accent-[var(--ink)]"
                  />
                  <span className="flex-1">{s.name}</span>
                  {!reachable && (
                    <span className="text-xs">no contact on file — can&apos;t be asked</span>
                  )}
                </label>
              );
            })
          )}
        </Panel>

        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-rule pt-5">
          {selected.length > 0 ? (
            // `Save RFQ` was a lie of omission — that button emailed three
            // companies and opened three external action items.
            <ConfirmSubmit
              trigger={`Send to ${selected.length} ${plural(selected.length, "supplier")}`}
              variant="primary"
              confirmVariant="primary"
              title={`Send to ${selected.length} ${plural(selected.length, "supplier")}?`}
              body="Each one gets an email with a one-tap link to price these lines — no account, no password — and starts being chased daily until they answer or decline."
              confirmLabel="Send it"
            />
          ) : (
            <SubmitButton pendingLabel="Saving…">Save as draft</SubmitButton>
          )}
          <p className="text-sm text-ink-faint">
            {selected.length > 0
              ? "This sends email immediately."
              : "Nobody is contacted until you send it."}
          </p>
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
