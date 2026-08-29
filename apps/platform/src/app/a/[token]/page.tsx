import type { Metadata } from "next";
import { findOpenActionItemByToken, claimCodeFor } from "@/lib/action-items";
import { db } from "@/lib/db";
import { ACTION_COPY } from "@/lib/lifecycle";
import { formatDate, formatMoney, formatQuantity, plural } from "@/lib/format";
import { PoResponseForm } from "./po-response-form";
import { QuoteForm } from "./quote-form";

export const metadata: Metadata = {
  title: "Respond",
  // This page is reached from an email link and should never be indexed —
  // the token in the URL is the authorization.
  robots: { index: false, follow: false },
};

/**
 * The external action view — the most widely distributed surface ZenoSource
 * owns and, for hundreds of supplier companies who will never pay us, the
 * entire product.
 *
 * What it replaces led with the *recipient's* name ("Requested from Sam
 * Supplier at Precision Parts"), showed no document number and no date, and
 * offered a generic `Acknowledge` button. A supplier could not tell which
 * order it referred to, what they were agreeing to, or by when.
 *
 * The rewrite leads with the buyer — the party the supplier has a
 * relationship with and is deciding whether to please — then the number, then
 * the commitment, then one full-width button that says exactly what pressing
 * it means.
 */
export default async function ActionViewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const item = await findOpenActionItemByToken(token);

  if (!item) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-ink">Nothing left to do here.</h1>
        {/* The old copy told a supplier who had *just successfully responded*
            to "ask your contact to resend the link" — the single most
            demoralizing sentence in the product, shown at the exact moment
            they'd done what was asked. */}
        <p className="mt-3 text-sm text-ink-soft">
          This has already been answered — either by you a moment ago, or by a colleague. Nothing
          further is needed and you can close this page.
        </p>
        <p className="mt-4 text-sm text-ink-faint">
          If you think something is still outstanding, reply to the email that brought you here and
          a person will see it.
        </p>
      </Shell>
    );
  }

  const tenant = await db.tenant.findUnique({
    where: { id: item.tenantId },
    select: { name: true },
  });
  const buyer = await db.internalUser.findFirst({
    where: { tenantId: item.tenantId, role: "OWNER", status: "ACTIVE" },
    select: { name: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  const tenantName = tenant?.name ?? "Your customer";
  const claim = claimCodeFor(token);

  if (item.actionType === "PO_ACKNOWLEDGE") {
    const po = await db.purchaseOrder.findUnique({
      where: { id: item.subjectId },
      include: { lines: { include: { location: true }, orderBy: { lineNumber: "asc" } } },
    });
    if (!po) return <Shell><p className="text-sm text-ink-soft">This link isn&apos;t valid.</p></Shell>;

    const needBy = po.lines
      .map((l) => l.needByDate)
      .filter((d): d is Date => d != null)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    return (
      <Shell tenantName={tenantName} claim={claim} buyer={buyer}>
        <p className="text-sm text-ink-soft">{tenantName} has sent you a purchase order.</p>
        <h1 className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-2xl font-semibold tracking-tight text-ink">
            {po.number}
          </span>
          <span className="font-mono text-lg text-ink-soft">{formatMoney(po.totalValue)}</span>
        </h1>
        {needBy && (
          <p className="mt-2 text-sm text-ink">
            Needed by <span className="font-mono font-semibold">{formatDate(needBy)}</span>
          </p>
        )}

        <LineTable lines={po.lines} />

        <PoResponseForm
          token={token}
          poNumber={po.number}
          tenantName={tenantName}
          lines={po.lines.map((l) => ({
            id: l.id,
            lineNumber: l.lineNumber,
            itemNumber: l.itemNumber,
            description: l.description,
            uom: l.uom,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            needByDate: l.needByDate ? l.needByDate.toISOString() : null,
          }))}
        />
      </Shell>
    );
  }

  if (item.actionType === "RFQ_SUBMIT_QUOTE") {
    const rfq = await db.rFQ.findUnique({
      where: { id: item.subjectId },
      include: { lines: { include: { location: true }, orderBy: { createdAt: "asc" } } },
    });
    if (!rfq) return <Shell><p className="text-sm text-ink-soft">This link isn&apos;t valid.</p></Shell>;

    return (
      <Shell tenantName={tenantName} claim={claim} buyer={buyer}>
        <p className="text-sm text-ink-soft">{tenantName} is asking you to price some work.</p>
        <h1 className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-2xl font-semibold tracking-tight text-ink">
            {rfq.number}
          </span>
          <span className="text-lg text-ink-soft">
            {rfq.lines.length} {plural(rfq.lines.length, "line")}
          </span>
        </h1>
        {rfq.quoteDeadline && (
          <p className="mt-2 text-sm text-ink">
            Quotes due by{" "}
            <span className="font-mono font-semibold">{formatDate(rfq.quoteDeadline)}</span>
          </p>
        )}

        <QuoteForm
          token={token}
          rfqNumber={rfq.number}
          tenantName={tenantName}
          lines={rfq.lines.map((l) => ({
            id: l.id,
            itemNumber: l.itemNumber,
            description: l.description,
            uom: l.uom,
            quantity: Number(l.quantity),
            needByDate: l.needByDate ? l.needByDate.toISOString() : null,
            locationName: l.location?.name ?? null,
          }))}
        />
      </Shell>
    );
  }

  return (
    <Shell tenantName={tenantName} claim={claim} buyer={buyer}>
      <h1 className="text-xl font-semibold text-ink">
        {ACTION_COPY[item.actionType]?.external || "There's something to respond to"}
      </h1>
      <p className="mt-3 text-sm text-ink-soft">
        Reply to the email that brought you here and {tenantName} will pick it up.
      </p>
    </Shell>
  );
}

function Shell({
  children,
  tenantName,
  claim,
  buyer,
}: {
  children: React.ReactNode;
  tenantName?: string;
  claim?: string;
  buyer?: { name: string; email: string } | null;
}) {
  return (
    <div className="flex flex-1 justify-center bg-paper px-4 py-8 sm:py-12">
      <div className="w-full max-w-2xl">
        <div className="border border-rule bg-paper-raised p-5 sm:p-8">
          {tenantName && (
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-ink pb-3">
              <span className="text-base font-semibold text-ink">{tenantName}</span>
              {claim && (
                <span className="font-mono text-xs text-ink-faint" title="Quote this if you call">
                  ref {claim}
                </span>
              )}
            </div>
          )}
          {children}
        </div>

        <div className="mt-4 space-y-1 px-1 text-xs text-ink-faint">
          <p>
            No account and no password — this link is yours alone, for this one thing, and stays
            valid until it&apos;s answered.
          </p>
          {buyer && (
            <p>
              Reply to the email that brought you here and it reaches{" "}
              <span className="text-ink-soft">{buyer.name}</span>.
            </p>
          )}
          <p>Sent through ZenoSource.</p>
        </div>
      </div>
    </div>
  );
}

function LineTable({
  lines,
}: {
  lines: {
    id: string;
    lineNumber: number;
    itemNumber: string;
    description: string;
    uom: string;
    quantity: unknown;
    unitPrice: unknown;
    location: { name: string } | null;
  }[];
}) {
  return (
    <div className="mt-5">
      {/* Stacked on a phone, tabular from `sm` up.
          Not a scrolling table: this arrives from an email on a handset, often
          one-handed on a shop floor, and a horizontal scrollbar is where a
          supplier decides the link is broken. The audit measured the previous
          version overflowing 390px by 83%. */}
      <ul className="divide-y divide-rule border-y border-rule sm:hidden">
        {lines.map((line) => (
          <li key={line.id} className="py-3">
            <p className="font-mono text-sm font-medium text-ink">{line.itemNumber}</p>
            <p className="text-sm text-ink-soft">{line.description}</p>
            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <div className="flex gap-1.5">
                <dt className="text-ink-faint">Qty</dt>
                <dd className="font-mono tabular-nums text-ink">
                  {formatQuantity(line.quantity as number)} {line.uom}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-ink-faint">Price</dt>
                <dd className="font-mono tabular-nums text-ink">
                  {formatMoney(line.unitPrice as number)}
                </dd>
              </div>
              {line.location && (
                <div className="flex gap-1.5">
                  <dt className="text-ink-faint">Ship to</dt>
                  <dd className="text-ink">{line.location.name}</dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ul>

      <table className="hidden w-full border-collapse text-sm sm:table">
        <caption className="sr-only">Lines on this purchase order</caption>
        <thead>
          <tr className="border-b border-rule-strong text-[11px] uppercase tracking-wider text-ink-faint">
            <th scope="col" className="py-1.5 text-left font-semibold">Item</th>
            <th scope="col" className="py-1.5 text-right font-semibold">Qty</th>
            <th scope="col" className="py-1.5 text-right font-semibold">Price</th>
            <th scope="col" className="py-1.5 text-right font-semibold">Ship to</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-rule">
              <td className="py-2.5 pr-2">
                <span className="font-mono text-xs font-medium text-ink">{line.itemNumber}</span>
                <span className="block text-ink-soft">{line.description}</span>
              </td>
              <td className="py-2.5 text-right font-mono tabular-nums">
                {formatQuantity(line.quantity as number)} {line.uom}
              </td>
              <td className="py-2.5 text-right font-mono tabular-nums">
                {formatMoney(line.unitPrice as number)}
              </td>
              <td className="py-2.5 pl-2 text-right text-ink-soft">
                {line.location?.name ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
