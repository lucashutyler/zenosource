import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { locationScopeFor, hasLocationAccess } from "@/lib/access";
import { loadOpenWork } from "@/lib/board";
import { duplicateRFQ, deleteDraftRFQ } from "@/app/actions/rfqs";
import { RFQ_STATUS_LABEL } from "@/lib/lifecycle";
import { formatDate, formatDwell, plural } from "@/lib/format";
import {
  Callout,
  DateText,
  DocNumber,
  Dwell,
  Ledger,
  LinkButton,
  MetaList,
  Money,
  PageHeader,
  Panel,
  Qty,
  Section,
  StatusChip,
  Td,
  Th,
} from "@/components/ui";
import { SimpleAction } from "@/components/simple-action";
import { AwardButton } from "./award-button";
import { CloseRFQForm } from "./close-form";
import { SendRFQForm } from "./send-form";
import { AddSupplierForm } from "./add-supplier-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const rfq = await db.rFQ.findUnique({ where: { id }, select: { number: true } });
  return { title: rfq ? `${rfq.number} · RFQ` : "RFQ" };
}

export default async function RFQDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentInternalUser();

  const rfq = await db.rFQ.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      lines: { include: { location: true }, orderBy: { createdAt: "asc" } },
      invites: { include: { supplier: true }, orderBy: { createdAt: "asc" } },
      quotes: { include: { supplier: true, lines: true } },
      awardedQuote: { include: { supplier: true } },
    },
  });
  if (!rfq) notFound();

  const scope = await locationScopeFor(user);
  if (!hasLocationAccess(rfq.lines.map((l) => l.locationId), scope)) notFound();

  const work = await loadOpenWork({
    tenantId: user.tenantId,
    viewerId: user.id,
    subjectType: "RFQ",
    subjectIds: [rfq.id],
  });
  const open = work.get(rfq.id);

  const submitted = rfq.quotes.filter((q) => q.status === "SUBMITTED");
  const terminal = rfq.status === "CLOSED";
  const decided = rfq.status === "AWARDED" || terminal;

  // Per-supplier totals and line coverage. Award was all-or-nothing on a whole
  // quote, and a no-bid cell rendered as a bare em-dash — indistinguishable
  // from "nothing here" — so it was possible to award a supplier who hadn't
  // priced half the request and find out at PO time.
  const quoteSummaries = submitted.map((quote) => {
    const covered = rfq.lines.filter((line) =>
      quote.lines.some((ql) => ql.rfqLineId === line.id)
    );
    const total = covered.reduce((sum, line) => {
      const ql = quote.lines.find((q) => q.rfqLineId === line.id)!;
      return sum + Number(line.quantity) * Number(ql.unitPrice);
    }, 0);
    const maxLead = quote.lines.reduce((max, ql) => Math.max(max, ql.leadTimeDays), 0);
    return {
      quote,
      coveredCount: covered.length,
      complete: covered.length === rfq.lines.length,
      total,
      maxLead,
    };
  });

  // Cheapest *comparable* quote — only quotes covering every line can be
  // ranked against each other on total.
  const complete = quoteSummaries.filter((s) => s.complete);
  const lowTotal = complete.length > 0 ? Math.min(...complete.map((s) => s.total)) : null;

  // Low bid per line, so a partial quote still shows where it wins.
  const lowByLine = new Map<string, number>();
  for (const line of rfq.lines) {
    const prices = submitted
      .map((q) => q.lines.find((ql) => ql.rfqLineId === line.id))
      .filter(Boolean)
      .map((ql) => Number(ql!.unitPrice));
    if (prices.length > 0) lowByLine.set(line.id, Math.min(...prices));
  }

  return (
    <div>
      <PageHeader
        back={{ href: "/dashboard/rfqs", label: "All RFQs" }}
        eyebrow="Request for quote"
        title={<DocNumber className="text-2xl">{rfq.number}</DocNumber>}
        meta={
          <MetaList>
            {[
              <StatusChip key="s" variant={terminal ? "settled" : "live"}>
                {RFQ_STATUS_LABEL[rfq.status]}
              </StatusChip>,
              <span key="l">
                {rfq.lines.length} {plural(rfq.lines.length, "line")}
              </span>,
              <span key="i">
                {rfq.invites.length} {plural(rfq.invites.length, "supplier")} invited
              </span>,
              <span key="q">
                {submitted.length} {plural(submitted.length, "quote")} in
              </span>,
              rfq.quoteDeadline ? (
                <span key="d">quotes due {formatDate(rfq.quoteDeadline)}</span>
              ) : null,
              open ? (
                <span key="w" className="inline-flex items-center gap-1.5">
                  waiting <Dwell since={open.openedAt} owned={open.ownedByViewer} />
                </span>
              ) : null,
            ].filter(Boolean) as React.ReactNode[]}
          </MetaList>
        }
        actions={
          <>
            {rfq.status === "DRAFT" && (
              <>
                <SendRFQForm rfqId={rfq.id} inviteCount={rfq.invites.length} />
                <SimpleAction
                  action={deleteDraftRFQ.bind(null, rfq.id)}
                  label="Delete draft"
                  variant="quiet"
                  confirm={{
                    title: `Delete ${rfq.number}?`,
                    body: "Nothing has been sent, so nothing is lost. The number is retired and the draft disappears — this is the clean exit from a mistake, rather than closing it into the list forever.",
                    confirmLabel: "Delete it",
                  }}
                />
              </>
            )}
            <SimpleAction
              action={duplicateRFQ.bind(null, rfq.id)}
              label="Duplicate"
              confirm={{
                title: `Duplicate ${rfq.number}?`,
                body: "Creates a new draft with the same lines and the same invited suppliers, under a new number. Nothing is sent until you send it.",
                confirmLabel: "Create the draft",
              }}
            />
            {!terminal && <CloseRFQForm rfqId={rfq.id} number={rfq.number} awarded={rfq.status === "AWARDED"} />}
          </>
        }
      />

      {rfq.status === "AWARDED" && rfq.awardedQuote && (
        <div className="mb-6">
          <Callout title={`Awarded to ${rfq.awardedQuote.supplier.name}`}>
            {/* An award that states its consequence, including what doesn't
                happen. Awarding creates no purchase order — a deliberate
                decision in docs/data-model.md — and before this nothing said
                so, so the winning quote quietly went nowhere. */}
            This closes the request for{" "}
            {rfq.invites
              .filter((i) => i.supplierId !== rfq.awardedQuote!.supplierId)
              .map((i) => i.supplier.name)
              .join(", ") || "the other invitees"}
            . It does <strong className="text-ink">not</strong> create a purchase order — raising
            that is on your board now.
            <div className="mt-3">
              <LinkButton href="/dashboard/purchase-orders/new" variant="primary">
                Raise the PO
              </LinkButton>
            </div>
          </Callout>
        </div>
      )}

      {rfq.status === "DRAFT" && rfq.invites.length === 0 && (
        <div className="mb-6">
          <Callout title="Nobody has been asked yet">
            A request for quote with no suppliers on it can never be sent. Invite at least one
            below.
          </Callout>
        </div>
      )}

      <Section title="Lines">
        <Ledger caption={`Lines on ${rfq.number}`}>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="right" width="8rem">Qty</Th>
              <Th align="right" width="8rem">Need by</Th>
              <Th width="10rem">Location</Th>
            </tr>
          </thead>
          <tbody>
            {rfq.lines.map((line) => (
              <tr key={line.id}>
                <Td>
                  <span className="font-mono font-medium">{line.itemNumber}</span>
                  <span className="block text-ink-soft">{line.description}</span>
                </Td>
                <Td align="right">
                  <Qty value={line.quantity} uom={line.uom} />
                </Td>
                <Td align="right">
                  <DateText value={line.needByDate} />
                </Td>
                <Td>{line.location?.name ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Ledger>
      </Section>

      <Section
        title="Who was asked"
        actions={
          !decided ? <AddSupplierForm rfqId={rfq.id} invitedIds={rfq.invites.map((i) => i.supplierId)} /> : undefined
        }
      >
        <Panel className="divide-y divide-rule">
          {rfq.invites.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-faint">No suppliers invited yet.</p>
          ) : (
            rfq.invites.map((invite) => {
              const since = rfq.sentAt ?? invite.createdAt;
              return (
                <div
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                >
                  <span className="text-ink">{invite.supplier.name}</span>
                  <span className="text-ink-soft">
                    {invite.status === "RESPONDED" ? (
                      <span className="text-settled">
                        quoted {formatDate(invite.respondedAt ?? new Date())}
                      </span>
                    ) : invite.status === "DECLINED" ? (
                      <span className="text-ink-faint">
                        declined {formatDate(invite.declinedAt ?? new Date())}
                      </span>
                    ) : rfq.status === "DRAFT" ? (
                      <span className="text-ink-faint">not sent yet</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        silent <Dwell since={since} />
                      </span>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </Panel>
      </Section>

      <Section
        title="Quotes"
        description={
          submitted.length > 0
            ? "Line by line. A blank cell is a supplier who didn't bid that line, not a zero."
            : undefined
        }
      >
        {submitted.length === 0 ? (
          <Panel className="px-4 py-6 text-sm text-ink-soft">
            {rfq.status === "DRAFT"
              ? "Nothing has been sent, so nothing can have come back."
              : `Nobody has quoted yet. ${rfq.invites.length} ${plural(rfq.invites.length, "supplier")} ${plural(rfq.invites.length, "has", "have")} been asked${rfq.sentAt ? `, ${formatDwell(rfq.sentAt)} ago` : ""}.`}
          </Panel>
        ) : (
          <div className="overflow-x-auto border border-rule bg-paper-raised">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <caption className="sr-only">Quote comparison by line</caption>
              <thead>
                <tr>
                  <Th width="16rem">Line</Th>
                  {quoteSummaries.map(({ quote, complete: full, coveredCount }) => (
                    <th
                      key={quote.id}
                      scope="col"
                      className="border-b border-rule-strong px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint"
                    >
                      <span className="block normal-case text-sm text-ink">{quote.supplier.name}</span>
                      {rfq.awardedQuoteId === quote.id && (
                        <span className="mt-1 inline-block normal-case tracking-normal text-settled">
                          awarded
                        </span>
                      )}
                      {!full && (
                        <span
                          className="mt-1 block normal-case tracking-normal text-age-3"
                          title="This quote doesn't cover every line"
                        >
                          {coveredCount} of {rfq.lines.length} lines
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rfq.lines.map((line) => (
                  <tr key={line.id}>
                    <Td>
                      <span className="font-mono font-medium">{line.itemNumber}</span>
                      <span className="block text-ink-soft">{line.description}</span>
                      <span className="block text-xs text-ink-faint">
                        <Qty value={line.quantity} uom={line.uom} />
                      </span>
                    </Td>
                    {quoteSummaries.map(({ quote }) => {
                      const ql = quote.lines.find((q) => q.rfqLineId === line.id);
                      if (!ql) {
                        return (
                          <Td key={quote.id}>
                            <span className="text-ink-faint" title="Did not bid this line">
                              no bid
                            </span>
                          </Td>
                        );
                      }
                      const price = Number(ql.unitPrice);
                      const isLow = lowByLine.get(line.id) === price;
                      return (
                        <Td key={quote.id} mono>
                          <span className={isLow ? "font-semibold text-settled" : undefined}>
                            <Money value={price} precise />
                          </span>
                          <span className="block text-xs text-ink-faint">
                            {ql.leadTimeDays} {plural(ql.leadTimeDays, "day")} lead
                          </span>
                          {ql.notes && (
                            <span className="mt-1 block max-w-[14rem] text-xs text-ink-soft">
                              {ql.notes}
                            </span>
                          )}
                        </Td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <Td className="border-t-2 border-ink font-medium">Quoted total</Td>
                  {quoteSummaries.map(({ quote, total, complete: full, maxLead }) => (
                    <Td key={quote.id} mono className="border-t-2 border-ink">
                      <span
                        className={
                          full && total === lowTotal ? "font-semibold text-settled" : "font-semibold"
                        }
                      >
                        <Money value={total} />
                      </span>
                      <span className="block text-xs font-normal text-ink-faint">
                        {full ? `${maxLead} ${plural(maxLead, "day")} longest lead` : "partial"}
                      </span>
                    </Td>
                  ))}
                </tr>
              </tfoot>
            </table>

            {!decided && (
              <div className="flex flex-wrap gap-2 border-t border-rule p-4">
                {quoteSummaries.map((summary) => (
                  <AwardButton
                    key={summary.quote.id}
                    rfqId={rfq.id}
                    quoteId={summary.quote.id}
                    supplierName={summary.quote.supplier.name}
                    total={summary.total}
                    complete={summary.complete}
                    coveredCount={summary.coveredCount}
                    lineCount={rfq.lines.length}
                    otherSuppliers={rfq.invites
                      .filter((i) => i.supplierId !== summary.quote.supplierId)
                      .map((i) => i.supplier.name)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
