"use client";

import { deletePriceBreak } from "@/app/actions/price-lists";
import { SimpleAction } from "@/components/simple-action";
import { formatCount, formatUnitPrice } from "@/lib/format";

export function PriceBreakRow({
  id,
  minQuantity,
  maxQuantity,
  unitPrice,
  deletable,
}: {
  id: string;
  minQuantity: number;
  maxQuantity: number | null;
  unitPrice: number;
  deletable: boolean;
}) {
  return (
    <tr className="border-t border-rule">
      <td className="py-1.5 font-mono tabular-nums">{formatCount(minQuantity)}</td>
      <td className="py-1.5 font-mono tabular-nums text-ink-soft">
        {maxQuantity == null ? "—" : formatCount(maxQuantity)}
      </td>
      <td className="py-1.5 text-right font-mono tabular-nums">{formatUnitPrice(unitPrice)}</td>
      <td className="py-1.5 text-right">
        {/* The last break is the price — removing it leaves a part that claims
            a negotiated rate and can't say what it is. The action refuses
            server-side too; hiding the control just avoids the dead end. */}
        {deletable && (
          <SimpleAction
            action={deletePriceBreak.bind(null, id)}
            label="Remove"
            variant="quiet"
          />
        )}
      </td>
    </tr>
  );
}
