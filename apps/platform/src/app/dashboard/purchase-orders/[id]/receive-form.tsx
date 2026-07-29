"use client";

import { useActionState } from "react";
import { receivePurchaseOrderLines } from "@/app/actions/purchase-orders";
import { ConfirmSubmit } from "@/components/forms";
import { ErrorText } from "@/components/ui";
import { formatQuantity, toDateInputValue } from "@/lib/format";
import { TERMINAL_LINE_STATUSES } from "@/lib/lifecycle";
import type { PurchaseOrderLineStatus } from "@/generated/prisma/enums";

// Plain numbers — see the note in proposal-decision.tsx.
type Line = {
  id: string;
  lineNumber: number;
  itemNumber: string;
  uom: string;
  quantity: number;
  receivedQuantity: number | null;
  status: PurchaseOrderLineStatus;
};

/**
 * Recording receipt — the transition that did not exist.
 *
 * `IN_PROGRESS`, `FULFILLED` and `CLOSED` were reachable only by seeding the
 * database, so an acknowledged order sat in ACKNOWLEDGED forever with no
 * action available but Duplicate, and the supplier's obligation was never
 * discharged. Per line, because partial delivery is the normal case here, not
 * the exception; the header rolls up from the lines rather than being set
 * separately, so the two can't disagree.
 */
export function ReceiveForm({
  po,
}: {
  po: { id: string; number: string; lines: Line[] };
}) {
  const [state, action] = useActionState(
    receivePurchaseOrderLines.bind(null, po.id),
    undefined
  );

  const open = po.lines.filter((l) => !TERMINAL_LINE_STATUSES.includes(l.status));
  if (open.length === 0) return null;

  return (
    <form action={action}>
      <ConfirmSubmit
        trigger="Record receipt"
        variant="primary"
        confirmVariant="primary"
        title={`What arrived against ${po.number}?`}
        body="Leave a line blank if none of it turned up. Once every line is complete the order becomes fully received and it's yours to close out."
        confirmLabel="Record it"
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="receivedAt" className="mb-1 block text-sm font-medium text-ink">
              Received on
            </label>
            <input
              id="receivedAt"
              name="receivedAt"
              type="date"
              defaultValue={toDateInputValue(new Date())}
              className="min-h-11 w-full border border-rule-strong bg-paper-raised px-3 py-2 text-sm text-ink"
            />
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-[11px] uppercase tracking-wider text-ink-faint">
                <th scope="col" className="py-1.5 text-left font-semibold">Item</th>
                <th scope="col" className="py-1.5 text-right font-semibold">Ordered</th>
                <th scope="col" className="py-1.5 text-right font-semibold">Arrived</th>
              </tr>
            </thead>
            <tbody>
              {open.map((line) => {
                const outstanding = line.quantity - (line.receivedQuantity ?? 0);
                return (
                  <tr key={line.id} className="border-b border-rule">
                    <td className="py-2">
                      <label htmlFor={`received-${line.id}`} className="font-mono text-xs">
                        {line.itemNumber}
                      </label>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-ink-soft">
                      {formatQuantity(outstanding)} {line.uom}
                    </td>
                    <td className="py-2 text-right">
                      <input
                        id={`received-${line.id}`}
                        name={`received-${line.id}`}
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        placeholder="0"
                        className="min-h-11 w-24 border border-rule-strong bg-paper-raised px-2 py-2 text-right font-mono text-sm text-ink"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ConfirmSubmit>
      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && (
        <p role="status" className="mt-2 text-sm text-settled">
          {state.ok}
        </p>
      )}
    </form>
  );
}
