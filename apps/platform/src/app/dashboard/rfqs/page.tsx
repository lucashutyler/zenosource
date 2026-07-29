import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { locationScopeFor } from "@/lib/access";
import { normalizeDocumentNumberQuery } from "@/lib/document-number";
import { loadOpenWork, pageFrom, paginationRange } from "@/lib/board";
import { RFQ_COURT, RFQ_EXPECTED_ACTION, RFQ_STATUS_LABEL, whatsOwed } from "@/lib/lifecycle";
import { formatCount, formatDate, plural } from "@/lib/format";
import {
  CourtMark,
  DateText,
  DocNumber,
  Dwell,
  EmptyState,
  Ledger,
  LinkButton,
  PageHeader,
  StatusChip,
  Td,
  Th,
} from "@/components/ui";
import { ListFilters, Pagination } from "@/components/list-controls";
import { InviteeDots } from "./invitee-dots";
import type { Prisma } from "@/generated/prisma/client";
import type { RFQStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "RFQs" };

const STATUS_VALUES = Object.keys(RFQ_STATUS_LABEL) as RFQStatus[];

export default async function RFQsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentInternalUser();

  const status =
    params.status && STATUS_VALUES.includes(params.status as RFQStatus)
      ? (params.status as RFQStatus)
      : undefined;

  const scope = await locationScopeFor(user);

  const q = params.q?.trim();
  const numberQuery = q ? normalizeDocumentNumberQuery(q) : null;
  const search: Prisma.RFQWhereInput | undefined = q
    ? {
        OR: [
          ...(numberQuery ? [{ number: { contains: numberQuery } }] : []),
          { number: { contains: q, mode: "insensitive" as const } },
          { lines: { some: { itemNumber: { contains: q, mode: "insensitive" as const } } } },
          { lines: { some: { description: { contains: q, mode: "insensitive" as const } } } },
          { invites: { some: { supplier: { name: { contains: q, mode: "insensitive" as const } } } } },
        ],
      }
    : undefined;

  const where: Prisma.RFQWhereInput = {
    tenantId: user.tenantId,
    ...(status ? { status } : {}),
    // Members are restricted to POs at their assigned locations (see
    // docs/data-model.md#location); RFQs carry the same per-line locationId
    // and must be scoped identically — otherwise a restricted member sees
    // every RFQ in the tenant regardless of assignment.
    ...(scope ? { lines: { some: { locationId: { in: scope } } } } : {}),
    ...(search ?? {}),
  };

  const total = await db.rFQ.count({ where });
  const range = paginationRange(pageFrom(params), total);

  const rfqs = await db.rFQ.findMany({
    where,
    include: {
      _count: { select: { lines: true } },
      invites: { include: { supplier: { select: { name: true } } } },
      awardedQuote: { include: { supplier: { select: { name: true } } } },
    },
    orderBy: { updatedAt: "desc" },
    skip: range.skip,
    take: range.take,
  });

  const work = await loadOpenWork({
    tenantId: user.tenantId,
    viewerId: user.id,
    subjectType: "RFQ",
    subjectIds: rfqs.map((r) => r.id),
  });

  const rows = [...rfqs].sort((a, b) => {
    const aw = work.get(a.id);
    const bw = work.get(b.id);
    if (aw && bw) return aw.openedAt.getTime() - bw.openedAt.getTime();
    if (aw) return -1;
    if (bw) return 1;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  const filtered = Boolean(status || q);

  return (
    <div>
      <PageHeader
        title="Requests for quote"
        meta={
          total > 0 ? (
            <>
              {formatCount(total)} {plural(total, "request")}
              {filtered ? " matching" : ""} · waiting longest first
            </>
          ) : undefined
        }
        actions={
          <LinkButton href="/dashboard/rfqs/new" variant="primary">
            New RFQ
          </LinkButton>
        }
      />

      <ListFilters
        searchPlaceholder="Number, supplier, part or description"
        searchValue={q ?? ""}
        filters={[
          {
            name: "status",
            label: "Status",
            value: params.status ?? "",
            allLabel: "Any status",
            options: STATUS_VALUES.map((s) => ({ value: s, label: RFQ_STATUS_LABEL[s] })),
          },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState
          headline={filtered ? "Nothing matches those filters." : "No requests for quote yet."}
          body={
            filtered
              ? "Try a part number or a supplier name."
              : "Ask several suppliers for a price on the same lines, then compare them side by side."
          }
          action={
            filtered ? (
              <LinkButton href="/dashboard/rfqs">Clear filters</LinkButton>
            ) : (
              <LinkButton href="/dashboard/rfqs/new" variant="primary">
                New RFQ
              </LinkButton>
            )
          }
        />
      ) : (
        <>
          <Ledger caption="Requests for quote, waiting longest first">
            <thead>
              <tr>
                <Th width="7.5rem">№</Th>
                <Th>What&apos;s owed</Th>
                <Th width="10rem">Invitees</Th>
                <Th align="right" width="6rem">Waiting</Th>
                <Th align="right" width="7.5rem">Quotes due</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((rfq) => {
                const open = work.get(rfq.id);
                const expected = RFQ_EXPECTED_ACTION[rfq.status];
                const unowned = expected !== null && !open;
                const settled =
                  rfq.status === "CLOSED"
                    ? `closed ${formatDate(rfq.closedAt ?? rfq.updatedAt)}`
                    : null;

                return (
                  <tr key={rfq.id} className="hover:bg-rule/30">
                    <Td mono>
                      <Link
                        href={`/dashboard/rfqs/${rfq.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        <DocNumber>{rfq.number}</DocNumber>
                      </Link>
                      <span className="mt-0.5 block text-xs text-ink-faint">
                        {rfq._count.lines} {plural(rfq._count.lines, "line")}
                      </span>
                    </Td>
                    <Td>
                      {unowned ? (
                        <StatusChip variant="unowned">
                          {RFQ_STATUS_LABEL[rfq.status]} — nobody chased
                        </StatusChip>
                      ) : (
                        <CourtMark court={RFQ_COURT[rfq.status]}>
                          {rfq.status === "AWARDED" && rfq.awardedQuote
                            ? `Won by ${rfq.awardedQuote.supplier.name} — raise the PO`
                            : whatsOwed({
                                actionType: open?.actionType ?? null,
                                supplierName: `${rfq.invites.length} ${plural(rfq.invites.length, "supplier")}`,
                                ownedByViewer: open?.ownedByViewer,
                                settled: settled ?? undefined,
                              })}
                        </CourtMark>
                      )}
                    </Td>
                    <Td>
                      <InviteeDots invites={rfq.invites} sentAt={rfq.sentAt} />
                    </Td>
                    <Td align="right">
                      <Dwell
                        since={open?.openedAt ?? null}
                        owned={open?.ownedByViewer}
                        settled={settled ? "closed" : null}
                      />
                    </Td>
                    <Td align="right">
                      {rfq.quoteDeadline ? (
                        <DateText value={rfq.quoteDeadline} />
                      ) : (
                        <span className="text-ink-faint" title="No deadline — nothing to escalate against">
                          open-ended
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Ledger>
          <Pagination range={range} />
        </>
      )}
    </div>
  );
}
