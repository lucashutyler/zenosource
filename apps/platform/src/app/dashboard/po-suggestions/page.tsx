import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { formatDate, formatDueIn, plural } from "@/lib/format";
import { Callout, DocNumber, EmptyState, Ledger, Money, PageHeader, Qty, Td, Th } from "@/components/ui";
import { requireFeature } from "@/lib/integrations/connections";
import { SuggestionDecision } from "./decision";

export const metadata: Metadata = { title: "PO suggestions" };

export default async function POSuggestionsPage() {
  const user = await getCurrentInternalUser();

  // The gate, at the route rather than only in the nav. A hidden link that
  // still renders when typed is the same class of bug as the locations list
  // that was tenant-scoped but not location-scoped — and this one would show
  // an empty screen with no explanation for why it exists.
  await requireFeature(user.tenantId, "po-suggestions");

  const suggestions = await db.pOSuggestion.findMany({
    where: { tenantId: user.tenantId, status: "OPEN" },
    include: { supplier: { select: { id: true, name: true } } },
    // Soonest-needed first. Unlike everything else in the product, a
    // suggestion has no dwell to rank by — nobody is waiting on anyone yet,
    // which is the point of acting before they are. The need-by date is the
    // clock that matters here.
    orderBy: [{ suggestedDate: "asc" }, { createdAt: "asc" }],
    take: 200,
  });

  const totalValue = suggestions.reduce(
    (sum, s) => sum + Number(s.suggestedQuantity) * Number(s.suggestedUnitPrice ?? 0),
    0
  );

  return (
    <div>
      <PageHeader
        title="PO suggestions"
        meta={
          suggestions.length > 0
            ? `${plural(suggestions.length, "suggestion")} from your last MRP run, soonest first.`
            : undefined
        }
      />

      {suggestions.length === 0 ? (
        <EmptyState
          headline="Nothing suggested right now."
          body="Your ERP's MRP run puts suggestions here when demand outruns supply. An empty list means it isn't proposing anything — not that the connection is broken."
        />
      ) : (
        <>
          <div className="mb-5">
            <Callout title="These come from your ERP, not from us">
              Epicor&apos;s MRP run decides what to suggest. Accepting one raises a requisition in
              Epicor, which still has to clear approval there before it becomes an order — nothing
              is sent to a supplier from this screen.
            </Callout>
          </div>

          <Ledger caption="Open PO suggestions">
            <thead>
              <tr>
                <Th>Part</Th>
                <Th>Supplier</Th>
                <Th align="right" width="7rem">
                  Qty
                </Th>
                <Th align="right" width="8rem">
                  Value
                </Th>
                <Th width="9rem">Needed</Th>
                <Th width="14rem" />
              </tr>
            </thead>
            <tbody>
              {suggestions.map((suggestion) => (
                <tr key={suggestion.id} className="hover:bg-rule/30">
                  <Td>
                    <DocNumber>{suggestion.itemNumber}</DocNumber>
                    <span className="ml-2 text-ink-soft">{suggestion.description}</span>
                  </Td>
                  <Td>
                    <Link
                      href={`/dashboard/suppliers/${suggestion.supplier.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {suggestion.supplier.name}
                    </Link>
                  </Td>
                  <Td align="right">
                    <Qty value={Number(suggestion.suggestedQuantity)} />
                  </Td>
                  <Td align="right">
                    {suggestion.suggestedUnitPrice ? (
                      <Money
                        value={
                          Number(suggestion.suggestedQuantity) * Number(suggestion.suggestedUnitPrice)
                        }
                      />
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </Td>
                  <Td>
                    <div>{formatDate(suggestion.suggestedDate)}</div>
                    <div className="text-xs text-ink-faint">
                      {formatDueIn(suggestion.suggestedDate)}
                    </div>
                  </Td>
                  <Td>
                    <SuggestionDecision
                      suggestionId={suggestion.id}
                      itemNumber={suggestion.itemNumber}
                      supplierName={suggestion.supplier.name}
                      quantity={Number(suggestion.suggestedQuantity)}
                      needByDate={suggestion.suggestedDate.toISOString().slice(0, 10)}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Ledger>

          {totalValue > 0 && (
            <p className="mt-4 text-sm text-ink-soft">
              <Money value={totalValue} /> of proposed spend across{" "}
              {plural(suggestions.length, "suggestion")}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
