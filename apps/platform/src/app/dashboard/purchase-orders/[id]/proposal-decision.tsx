"use client";

import { useActionState } from "react";
import { acceptChangeProposal, rejectChangeProposal } from "@/app/actions/purchase-orders";
import { ConfirmSubmit } from "@/components/forms";
import { Money, Qty, DateText, Panel } from "@/components/ui";
import { formatDate } from "@/lib/format";

// Plain numbers, converted by the server component at the boundary — Prisma
// Decimals are class instances and don't belong in Client Component props.
type Line = {
  id: string;
  lineNumber: number;
  itemNumber: string;
  description: string;
  uom: string;
  quantity: number;
  unitPrice: number;
  needByDate: Date | null;
  proposedQuantity: number | null;
  proposedUnitPrice: number | null;
  proposedDate: Date | null;
  proposedBySupplierContact: string | null;
  proposedAt: Date | null;
};

/**
 * A supplier's counter-proposal, as a diff.
 *
 * The old rendering was a sentence in an amber box: "Sam proposed: qty 550,
 * price $8.90, by 12/09/2026". A buyer had to hold the current values in their
 * head and do the arithmetic to know whether to care.
 *
 * Extended value is the last row and the heaviest, because it is the one that
 * decides. A 441% jump on a $12 line matters less than 4% on a $90,000 one,
 * and rendering price as the headline gets that backwards every time.
 */
export function ProposalDecision({ line }: { line: Line }) {
  const [acceptState, acceptAction] = useActionState(
    async () => acceptChangeProposal(line.id),
    undefined
  );
  const [rejectState, rejectAction] = useActionState(
    async () => rejectChangeProposal(line.id),
    undefined
  );
  void acceptState;
  void rejectState;

  const oldQty = line.quantity;
  const newQty = line.proposedQuantity ?? line.quantity;
  const oldPrice = line.unitPrice;
  const newPrice = line.proposedUnitPrice ?? line.unitPrice;
  const oldExtended = oldQty * oldPrice;
  const newExtended = newQty * newPrice;
  const delta = newExtended - oldExtended;
  const pct = oldExtended === 0 ? null : (delta / oldExtended) * 100;

  const dateSlipDays =
    line.proposedDate && line.needByDate
      ? Math.round((line.proposedDate.getTime() - line.needByDate.getTime()) / 86_400_000)
      : null;

  return (
    <Panel className="p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          <span className="font-mono font-medium">{line.itemNumber}</span>
          <span className="ml-2 text-ink-soft">{line.description}</span>
        </p>
        <p className="text-xs text-ink-faint">
          {line.proposedBySupplierContact ?? "The supplier"} proposed
          {line.proposedAt ? ` ${formatDate(line.proposedAt)}` : ""}
        </p>
      </div>

      <table className="w-full text-sm">
        <caption className="sr-only">
          Proposed changes to line {line.lineNumber}, {line.itemNumber}
        </caption>
        <thead>
          <tr className="border-b border-rule text-[11px] uppercase tracking-wider text-ink-faint">
            <th scope="col" className="py-1.5 text-left font-semibold">
              What
            </th>
            <th scope="col" className="py-1.5 text-right font-semibold">
              Ordered
            </th>
            <th scope="col" className="py-1.5 text-right font-semibold">
              Proposed
            </th>
            <th scope="col" className="py-1.5 text-right font-semibold">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          <DiffRow
            label="Quantity"
            changed={newQty !== oldQty}
            was={<Qty value={oldQty} uom={line.uom} />}
            now={<Qty value={newQty} uom={line.uom} />}
            delta={newQty === oldQty ? null : `${newQty > oldQty ? "+" : ""}${newQty - oldQty}`}
          />
          <DiffRow
            label="Unit price"
            changed={newPrice !== oldPrice}
            was={<Money value={oldPrice} precise />}
            now={<Money value={newPrice} precise />}
            delta={
              newPrice === oldPrice
                ? null
                : `${newPrice > oldPrice ? "+" : ""}${(((newPrice - oldPrice) / oldPrice) * 100).toFixed(1)}%`
            }
          />
          <DiffRow
            label="Date"
            changed={line.proposedDate?.getTime() !== line.needByDate?.getTime()}
            was={<DateText value={line.needByDate} />}
            now={<DateText value={line.proposedDate} />}
            delta={dateSlipDays == null || dateSlipDays === 0 ? null : `${dateSlipDays > 0 ? "+" : ""}${dateSlipDays}d`}
          />
          {/* Last and heaviest. This is the number the decision turns on. */}
          <tr className="border-t-2 border-ink">
            <th scope="row" className="py-2 text-left font-semibold">
              Extended value
            </th>
            <td className="py-2 text-right font-mono tabular-nums text-ink-faint line-through">
              <Money value={oldExtended} />
            </td>
            <td className="py-2 text-right font-mono text-base font-semibold tabular-nums">
              <Money value={newExtended} />
            </td>
            <td
              className={`py-2 text-right font-mono font-semibold tabular-nums ${
                delta > 0 ? "text-age-4" : delta < 0 ? "text-settled" : "text-ink-faint"
              }`}
            >
              {delta === 0
                ? "—"
                : `${delta > 0 ? "+" : ""}${pct == null ? "" : `${pct.toFixed(1)}%`}`}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 flex flex-wrap gap-2">
        <form action={acceptAction}>
          <ConfirmSubmit
            trigger="Accept the change"
            variant="secondary"
            confirmVariant="primary"
            title={`Accept ${line.proposedBySupplierContact ?? "the supplier"}'s change?`}
            body={
              <>
                Line {line.lineNumber} becomes{" "}
                <strong className="text-ink">
                  {newQty} {line.uom} at ${newPrice}
                </strong>
                {line.proposedDate ? ` for ${formatDate(line.proposedDate)}` : ""} — a{" "}
                {delta >= 0 ? "increase" : "reduction"} of{" "}
                <strong className="text-ink">
                  ${Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </strong>{" "}
                on this line. The supplier is told; the order total updates.
              </>
            }
            confirmLabel="Accept it"
          />
        </form>
        <form action={rejectAction}>
          <ConfirmSubmit
            trigger="Hold the original terms"
            variant="quiet"
            title="Decline this change?"
            body={
              <>
                Line {line.lineNumber} stays at{" "}
                <strong className="text-ink">
                  {oldQty} {line.uom} at ${oldPrice}
                </strong>
                . The supplier is told what was declined and why it stands — this does not
                cancel the order, and they still owe you the original.
              </>
            }
            confirmLabel="Decline it"
          />
        </form>
      </div>
    </Panel>
  );
}

function DiffRow({
  label,
  changed,
  was,
  now,
  delta,
}: {
  label: string;
  changed: boolean;
  was: React.ReactNode;
  now: React.ReactNode;
  delta: string | null;
}) {
  return (
    <tr className="border-b border-rule">
      <th scope="row" className="py-2 text-left font-normal text-ink-soft">
        {label}
      </th>
      <td
        className={`py-2 text-right font-mono tabular-nums ${changed ? "text-ink-faint line-through" : "text-ink-faint"}`}
      >
        {was}
      </td>
      <td className={`py-2 text-right font-mono tabular-nums ${changed ? "font-medium" : "text-ink-faint"}`}>
        {changed ? now : "unchanged"}
      </td>
      <td className="py-2 text-right font-mono tabular-nums text-ink-soft">{delta ?? "—"}</td>
    </tr>
  );
}
