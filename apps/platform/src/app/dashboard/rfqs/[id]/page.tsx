import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { awardRFQQuote, duplicateRFQ, closeRFQ } from "@/app/actions/rfqs";
import { Card, PageHeader, Badge, SubmitButton } from "@/components/ui";

const STATUS_TONE: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  SENT: "warning",
  RESPONSES_OPEN: "warning",
  AWARDED: "success",
  CLOSED: "neutral",
};

const INVITE_TONE: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  INVITED: "neutral",
  RESPONDED: "success",
  DECLINED: "danger",
};

export default async function RFQDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentInternalUser();
  if (!user) notFound();

  const rfq = await db.rFQ.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      lines: { include: { location: true } },
      invites: { include: { supplier: true } },
      quotes: { include: { supplier: true, lines: true } },
      awardedQuote: { include: { supplier: true } },
    },
  });
  if (!rfq) notFound();

  const submittedQuotes = rfq.quotes.filter((q) => q.status === "SUBMITTED");
  const boundDuplicate = duplicateRFQ.bind(null, rfq.id);
  const boundClose = closeRFQ.bind(null, rfq.id);
  const isTerminal = rfq.status === "AWARDED" || rfq.status === "CLOSED";

  return (
    <div>
      <PageHeader
        title={`RFQ-${rfq.id.slice(-6).toUpperCase()}`}
        subtitle={`Created ${rfq.createdAt.toLocaleDateString()}`}
        action={
          <Badge tone={STATUS_TONE[rfq.status] ?? "neutral"}>
            {rfq.status.replaceAll("_", " ").toLowerCase()}
          </Badge>
        }
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <form action={boundDuplicate}>
          <SubmitButton variant="secondary">Duplicate</SubmitButton>
        </form>
        {!isTerminal && (
          <form action={boundClose}>
            <SubmitButton variant="secondary">Close RFQ</SubmitButton>
          </form>
        )}
      </div>

      {rfq.status === "AWARDED" && rfq.awardedQuote && (
        <Card className="mb-6 border-green-200 p-4 dark:border-green-900">
          <p className="text-sm text-green-700 dark:text-green-400">
            Awarded to {rfq.awardedQuote.supplier.name}
          </p>
        </Card>
      )}

      <Card className="mb-6">
        <div className="p-4">
          <h2 className="text-sm font-medium text-zinc-950 dark:text-zinc-50">Lines</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2">Qty</th>
              <th className="px-4 py-2">Need by</th>
              <th className="px-4 py-2">Location</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rfq.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-zinc-950 dark:text-zinc-50">{line.itemNumber}</p>
                  <p className="text-xs text-zinc-500">{line.description}</p>
                </td>
                <td className="px-4 py-3">
                  {line.quantity.toString()} {line.uom}
                </td>
                <td className="px-4 py-3">
                  {line.needByDate ? line.needByDate.toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-3">{line.location?.name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="mb-6">
        <div className="p-4">
          <h2 className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
            Invited suppliers
          </h2>
        </div>
        {rfq.invites.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-zinc-500">No suppliers invited yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {rfq.invites.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-zinc-950 dark:text-zinc-50">
                  {invite.supplier.name}
                </span>
                <Badge tone={INVITE_TONE[invite.status] ?? "neutral"}>
                  {invite.status.toLowerCase()}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="p-4">
          <h2 className="text-sm font-medium text-zinc-950 dark:text-zinc-50">Quotes</h2>
          <p className="text-xs text-zinc-500">
            Side-by-side comparison of submitted quotes, by line.
          </p>
        </div>
        {submittedQuotes.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-zinc-500">No quotes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="px-4 py-2">Line</th>
                  {submittedQuotes.map((q) => (
                    <th key={q.id} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {q.supplier.name}
                        {rfq.awardedQuoteId === q.id && <Badge tone="success">awarded</Badge>}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {rfq.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-950 dark:text-zinc-50">
                        {line.itemNumber}
                      </p>
                      <p className="text-xs text-zinc-500">{line.description}</p>
                    </td>
                    {submittedQuotes.map((q) => {
                      const qLine = q.lines.find((ql) => ql.rfqLineId === line.id);
                      return (
                        <td key={q.id} className="px-4 py-3">
                          {qLine ? (
                            <>
                              <p>${qLine.unitPrice.toString()}</p>
                              <p className="text-xs text-zinc-500">
                                {qLine.leadTimeDays} day{qLine.leadTimeDays === 1 ? "" : "s"} lead
                                time
                              </p>
                            </>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {!isTerminal && (
              <div className="flex flex-wrap gap-3 border-t border-zinc-200 p-4 dark:border-zinc-800">
                {submittedQuotes.map((q) => (
                  <form key={q.id} action={awardRFQQuote.bind(null, rfq.id, q.id)}>
                    <SubmitButton variant="secondary">Award to {q.supplier.name}</SubmitButton>
                  </form>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
