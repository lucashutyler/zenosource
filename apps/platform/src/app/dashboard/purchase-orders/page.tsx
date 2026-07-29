import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { locationScopeFor } from "@/lib/access";
import { normalizeDocumentNumberQuery } from "@/lib/document-number";
import {
  loadLineWorkByPurchaseOrder,
  loadOpenWork,
  mergeWork,
  pageFrom,
  paginationRange,
} from "@/lib/board";
import { PO_COURT, PO_EXPECTED_ACTION, PO_STATUS_LABEL, whatsOwed } from "@/lib/lifecycle";
import { formatDate, formatCount } from "@/lib/format";
import {
  CourtMark,
  DateText,
  DocNumber,
  Dwell,
  EmptyState,
  Ledger,
  LinkButton,
  Money,
  PageHeader,
  StatusChip,
  Td,
  Th,
} from "@/components/ui";
import { ListFilters, Pagination } from "@/components/list-controls";
import type { Prisma } from "@/generated/prisma/client";
import type { PurchaseOrderStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Purchase orders" };

const STATUS_VALUES = Object.keys(PO_STATUS_LABEL) as PurchaseOrderStatus[];

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; locationId?: string; supplierId?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentInternalUser();

  // Validate against the known enum values before it reaches Prisma — a
  // hand-edited ?status= would otherwise cast straight to the enum type and
  // 500 instead of just matching nothing.
  const status = params.status && STATUS_VALUES.includes(params.status as PurchaseOrderStatus)
    ? (params.status as PurchaseOrderStatus)
    : undefined;

  const scope = await locationScopeFor(user);
  const [locations, suppliers] = await Promise.all([
    db.location.findMany({
      where: { tenantId: user.tenantId, ...(scope ? { id: { in: scope } } : {}) },
      orderBy: { name: "asc" },
    }),
    db.supplier.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // A ?locationId= filter must narrow the caller's scope, never replace it —
  // otherwise a MEMBER could hand-edit the URL to see POs at a location
  // they aren't assigned to. An out-of-scope id resolves to an empty
  // filter set (matches nothing) rather than being honored.
  const effectiveLocationIds = params.locationId
    ? scope
      ? scope.includes(params.locationId)
        ? [params.locationId]
        : []
      : [params.locationId]
    : scope;

  // Search across everything a buyer would have in front of them when a
  // supplier rings: the number off the email, the company name, or the part
  // number they're asking about. "The supplier called about SKU-2050"
  // previously required opening all 25 orders one at a time.
  const q = params.q?.trim();
  const numberQuery = q ? normalizeDocumentNumberQuery(q) : null;
  const search: Prisma.PurchaseOrderWhereInput | undefined = q
    ? {
        OR: [
          ...(numberQuery ? [{ number: { contains: numberQuery } }] : []),
          { number: { contains: q, mode: "insensitive" as const } },
          { supplier: { name: { contains: q, mode: "insensitive" as const } } },
          { lines: { some: { itemNumber: { contains: q, mode: "insensitive" as const } } } },
          { lines: { some: { description: { contains: q, mode: "insensitive" as const } } } },
        ],
      }
    : undefined;

  const where: Prisma.PurchaseOrderWhereInput = {
    tenantId: user.tenantId,
    ...(status ? { status } : {}),
    ...(params.supplierId ? { supplierId: params.supplierId } : {}),
    ...(effectiveLocationIds
      ? { lines: { some: { locationId: { in: effectiveLocationIds } } } }
      : {}),
    ...(search ?? {}),
  };

  const total = await db.purchaseOrder.count({ where });
  const range = paginationRange(pageFrom(params), total);

  const purchaseOrders = await db.purchaseOrder.findMany({
    where,
    include: {
      supplier: { select: { name: true } },
      lines: {
        select: { needByDate: true, location: { select: { name: true } } },
        orderBy: { needByDate: "asc" },
      },
    },
    // There is one right order for a chase product and it is not the user's
    // to choose, so the `Sort` dropdown is gone. `updatedAt` descending is
    // the storage-level proxy for "most recently moved"; the true ordering —
    // dwell descending — needs the action-item join below, which happens in
    // memory over one page rather than as a correlated subquery over 900 rows.
    orderBy: { updatedAt: "desc" },
    skip: range.skip,
    take: range.take,
  });

  const poIds = purchaseOrders.map((po) => po.id);
  const [headerWork, lineWork] = await Promise.all([
    loadOpenWork({
      tenantId: user.tenantId,
      viewerId: user.id,
      subjectType: "PURCHASE_ORDER",
      subjectIds: poIds,
    }),
    loadLineWorkByPurchaseOrder({
      tenantId: user.tenantId,
      viewerId: user.id,
      purchaseOrderIds: poIds,
    }),
  ]);
  const work = mergeWork(headerWork, lineWork);

  // Waiting longest first, then everything at rest. This is the only sort.
  const rows = [...purchaseOrders].sort((a, b) => {
    const aw = work.get(a.id);
    const bw = work.get(b.id);
    if (aw && bw) return aw.openedAt.getTime() - bw.openedAt.getTime();
    if (aw) return -1;
    if (bw) return 1;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  const filtered = Boolean(status || params.locationId || params.supplierId || q);

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        meta={
          total > 0 ? (
            <>
              {formatCount(total)} {total === 1 ? "order" : "orders"}
              {filtered ? " matching" : ""} · waiting longest first
            </>
          ) : undefined
        }
        actions={<LinkButton href="/dashboard/purchase-orders/new" variant="primary">New PO</LinkButton>}
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
            options: STATUS_VALUES.map((s) => ({ value: s, label: PO_STATUS_LABEL[s] })),
          },
          {
            name: "supplierId",
            label: "Supplier",
            value: params.supplierId ?? "",
            allLabel: "Any supplier",
            options: suppliers.map((s) => ({ value: s.id, label: s.name })),
          },
          {
            name: "locationId",
            label: "Location",
            value: params.locationId ?? "",
            allLabel: "All accessible",
            options: locations.map((l) => ({ value: l.id, label: l.name })),
          },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState
          headline={filtered ? "Nothing matches those filters." : "No purchase orders yet."}
          body={
            filtered
              ? "Try a part number, a supplier name, or the number off the email."
              : "Raise one and it lands here the moment it's issued — with a clock on it."
          }
          action={
            filtered ? (
              <LinkButton href="/dashboard/purchase-orders">Clear filters</LinkButton>
            ) : (
              <LinkButton href="/dashboard/purchase-orders/new" variant="primary">
                New PO
              </LinkButton>
            )
          }
        />
      ) : (
        <>
          <Ledger caption="Purchase orders, waiting longest first">
            <thead>
              <tr>
                <Th width="7.5rem">№</Th>
                <Th width="12rem">Supplier</Th>
                <Th>What&apos;s owed</Th>
                <Th align="right" width="6rem">Waiting</Th>
                <Th align="right" width="8rem">Value</Th>
                <Th align="right" width="7.5rem">Need by</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((po) => {
                const open = work.get(po.id);
                const court = PO_COURT[po.status];
                const expected = PO_EXPECTED_ACTION[po.status];
                const needBy = po.lines.find((l) => l.needByDate)?.needByDate ?? null;
                const settled =
                  po.status === "CLOSED"
                    ? `closed ${formatDate(po.closedAt ?? po.updatedAt)}`
                    : po.status === "CANCELLED"
                      ? `cancelled ${formatDate(po.cancelledAt ?? po.updatedAt)}`
                      : null;

                // A non-terminal state with no open item is the modeling bug
                // docs/product.md names. It renders hatched rather than
                // blank, so it can't be mistaken for a designed state.
                const unowned = expected !== null && !open;

                return (
                  <tr key={po.id} className="hover:bg-rule/30">
                    <Td mono>
                      <Link
                        href={`/dashboard/purchase-orders/${po.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        <DocNumber>{po.number}</DocNumber>
                      </Link>
                    </Td>
                    <Td>{po.supplier.name}</Td>
                    <Td>
                      {unowned ? (
                        <StatusChip variant="unowned">
                          {PO_STATUS_LABEL[po.status]} — nobody chased
                        </StatusChip>
                      ) : (
                        <CourtMark court={court}>
                          {whatsOwed({
                            actionType: open?.actionType ?? null,
                            supplierName: po.supplier.name,
                            ownedByViewer: open?.ownedByViewer,
                            settled: settled ?? undefined,
                          })}
                        </CourtMark>
                      )}
                    </Td>
                    <Td align="right">
                      <Dwell
                        since={open?.openedAt ?? null}
                        owned={open?.ownedByViewer}
                        settled={settled ? PO_STATUS_LABEL[po.status].toLowerCase() : null}
                      />
                    </Td>
                    <Td align="right" mono>
                      <Money value={po.totalValue} />
                    </Td>
                    <Td align="right">
                      {needBy ? <DateText value={needBy} /> : <span className="text-ink-faint">—</span>}
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
