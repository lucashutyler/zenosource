import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { locationScopeFor, hasLocationAccess } from "@/lib/access";
import { loadOpenWork } from "@/lib/board";
import { buildPossessionSegments } from "@/lib/status-events";
import {
  PO_LINE_STATUS_LABEL,
  PO_STATUS_LABEL,
  TERMINAL_PO_STATUSES,
} from "@/lib/lifecycle";
import { formatDate, formatDateTime, formatQuantity, plural } from "@/lib/format";
import { duplicatePurchaseOrder, reviseRejectedPurchaseOrder } from "@/app/actions/purchase-orders";
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
import { CancelForm } from "./cancel-form";
import { IssueForm } from "./issue-form";
import { ReceiveForm } from "./receive-form";
import { CloseForm } from "./close-form";
import { ProposalDecision } from "./proposal-decision";
import { SimpleAction } from "@/components/simple-action";
import { PossessionStrip } from "./possession-strip";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    select: { number: true, supplier: { select: { name: true } } },
  });
  return { title: po ? `${po.number} · ${po.supplier.name}` : "Purchase order" };
}

export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ highlight?: string }>;
}) {
  const { id } = await params;
  const { highlight } = await searchParams;
  const user = await getCurrentInternalUser();

  const po = await db.purchaseOrder.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      supplier: { include: { contacts: { where: { status: "ACTIVE" }, orderBy: { name: "asc" } } } },
      lines: {
        orderBy: { lineNumber: "asc" },
        include: {
          location: true,
          changeProposals: { orderBy: { proposedAt: "desc" } },
        },
      },
      cancelledByUser: true,
      tenant: { select: { name: true } },
    },
  });
  if (!po) notFound();

  const scope = await locationScopeFor(user);
  if (!hasLocationAccess(po.lines.map((l) => l.locationId), scope)) notFound();

  const [work, events] = await Promise.all([
    loadOpenWork({
      tenantId: user.tenantId,
      viewerId: user.id,
      subjectType: "PURCHASE_ORDER",
      subjectIds: [po.id],
    }),
    db.statusEvent.findMany({
      where: { subjectType: "PURCHASE_ORDER", subjectId: po.id },
      orderBy: { occurredAt: "asc" },
    }),
  ]);
  const open = work.get(po.id);

  const terminal = TERMINAL_PO_STATUSES.includes(po.status);
  const locations = [...new Set(po.lines.map((l) => l.location?.name).filter(Boolean))];
  const segments = buildPossessionSegments(events, po.createdAt);

  return (
    <div>
      <PageHeader
        back={{ href: "/dashboard/purchase-orders", label: "All purchase orders" }}
        eyebrow="Purchase order"
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <DocNumber className="text-2xl">{po.number}</DocNumber>
            <span className="text-lg font-normal text-ink-soft">{po.supplier.name}</span>
          </span>
        }
        meta={
          <MetaList>
            {[
              <StatusChip key="s" variant={terminal ? "settled" : "live"}>
                {PO_STATUS_LABEL[po.status]}
              </StatusChip>,
              <span key="v" className="font-mono">
                <Money value={po.totalValue} />
              </span>,
              <span key="l">
                {po.lines.length} {plural(po.lines.length, "line")}
              </span>,
              locations.length > 0 ? <span key="loc">{locations.join(", ")}</span> : null,
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
            {po.status === "DRAFT" && (
              <>
                <LinkButton href={`/dashboard/purchase-orders/${po.id}/edit`}>Edit</LinkButton>
                <IssueForm poId={po.id} contacts={po.supplier.contacts} supplierName={po.supplier.name} />
              </>
            )}
            {(po.status === "ACKNOWLEDGED" || po.status === "IN_PROGRESS") && (
              <ReceiveForm
                po={{
                  id: po.id,
                  number: po.number,
                  lines: po.lines.map((l) => ({
                    id: l.id,
                    lineNumber: l.lineNumber,
                    itemNumber: l.itemNumber,
                    uom: l.uom,
                    quantity: Number(l.quantity),
                    receivedQuantity:
                      l.receivedQuantity == null ? null : Number(l.receivedQuantity),
                    status: l.status,
                  })),
                }}
              />
            )}
            {po.status === "FULFILLED" && <CloseForm poId={po.id} number={po.number} />}
            {po.status === "REJECTED" && (
              <SimpleAction
                action={reviseRejectedPurchaseOrder.bind(null, po.id)}
                label="Revise and reissue"
                variant="primary"
              />
            )}
            <SimpleAction
              action={duplicatePurchaseOrder.bind(null, po.id)}
              label="Duplicate"
              confirm={{
                title: `Duplicate ${po.number}?`,
                body: "This creates a new draft with the same lines and a new document number. Nothing is sent to the supplier until you issue it.",
                confirmLabel: "Create the draft",
              }}
            />
            <LinkButton href={`/dashboard/purchase-orders/${po.id}?print=1`} className="no-print">
              Print
            </LinkButton>
          </>
        }
      />

      {/* The possession strip: the whole life of the order, in one 28px bar.
          Sequenced after the lifecycle work on purpose — it stitches
          StatusEvent history into contiguous segments, so it is only honest
          once every transition writes one. Drawn against a partial log it
          would render gaps it can't explain. */}
      {segments.length > 1 && <PossessionStrip segments={segments} />}

      {po.status === "REJECTED" && (
        <div className="mb-6">
          <Callout title={`${po.supplier.name} rejected this order`}>
            {po.rejectionReason || "No reason given."}{" "}
            {po.rejectedAt && <span className="text-ink-faint">· {formatDate(po.rejectedAt)}</span>}
            <p className="mt-2">
              Revising creates a corrected draft and closes this one out, so the rejection stops
              being chased. Duplicating does neither.
            </p>
          </Callout>
        </div>
      )}
      {po.status === "CANCELLED" && (
        <div className="mb-6">
          <Callout title="Cancelled">
            {formatDate(po.cancelledAt)} by {po.cancelledByUser?.name ?? "unknown"}
            {po.cancellationReason ? ` — ${po.cancellationReason}` : ""}
          </Callout>
        </div>
      )}

      <Section title="Lines">
        <Ledger caption={`Lines on ${po.number}`}>
          <thead>
            <tr>
              <Th width="2.5rem">#</Th>
              <Th>Item</Th>
              <Th align="right" width="7rem">Qty</Th>
              <Th align="right" width="7rem">Unit</Th>
              <Th align="right" width="8rem">Extended</Th>
              <Th align="right" width="7rem">Need by</Th>
              <Th align="right" width="7rem">Promised</Th>
              <Th width="10rem">Status</Th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((line) => {
              const extended = Number(line.quantity) * Number(line.unitPrice);
              const highlighted = line.id === highlight;
              return (
                <tr
                  key={line.id}
                  id={`line-${line.id}`}
                  className={highlighted ? "bg-court-them-soft" : undefined}
                >
                  <Td mono>{line.lineNumber}</Td>
                  <Td>
                    <span className="font-mono font-medium">{line.itemNumber}</span>
                    <span className="block text-ink-soft">{line.description}</span>
                    {line.location && (
                      <span className="block text-xs text-ink-faint">{line.location.name}</span>
                    )}
                    {highlighted && (
                      <span className="mt-1 block text-xs font-medium text-court-them">
                        This is the line your action item is about.
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    <Qty value={line.quantity} uom={line.uom} />
                    {line.receivedQuantity != null && (
                      <span className="block text-xs text-ink-faint">
                        {formatQuantity(line.receivedQuantity)} received
                      </span>
                    )}
                  </Td>
                  <Td align="right" mono>
                    <Money value={line.unitPrice} precise />
                  </Td>
                  <Td align="right" mono>
                    <Money value={extended} />
                  </Td>
                  <Td align="right">
                    <DateText value={line.needByDate} />
                  </Td>
                  <Td align="right">
                    <DateText value={line.promiseDate} />
                  </Td>
                  <Td>
                    <StatusChip
                      variant={
                        line.status === "FULFILLED" ||
                        line.status === "CLOSED" ||
                        line.status === "CANCELLED"
                          ? "settled"
                          : "live"
                      }
                    >
                      {PO_LINE_STATUS_LABEL[line.status]}
                    </StatusChip>
                  </Td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <Td colSpan={4} align="right" className="border-t-2 border-ink font-medium">
                Order total
              </Td>
              <Td align="right" mono className="border-t-2 border-ink font-semibold">
                <Money value={po.totalValue} />
              </Td>
              <Td colSpan={3} className="border-t-2 border-ink" />
            </tr>
          </tfoot>
        </Ledger>
      </Section>

      {/* Change proposals get their own section rather than a cramped cell in
          the status column. They are the interaction this product is
          effectively named for, and we were losing them head-to-head with
          SourceDay on a layout problem: the old values were already in the
          row, just never placed next to the new ones. */}
      {po.lines.some((l) => l.status === "CHANGE_PROPOSED") && (
        <Section
          title="Proposed changes"
          description="Old values struck through, new alongside. Extended value is the row that decides it."
        >
          <div className="space-y-4">
            {po.lines
              .filter((l) => l.status === "CHANGE_PROPOSED")
              .map((line) => (
                // Decimals converted at the boundary. Prisma's Decimal is a
                // class instance, and Next warns (correctly) that only plain
                // objects cross into a Client Component — passing it through
                // works by accident of serialization, and reads as a number
                // that is silently an object on the other side.
                <ProposalDecision
                  key={line.id}
                  line={{
                    id: line.id,
                    lineNumber: line.lineNumber,
                    itemNumber: line.itemNumber,
                    description: line.description,
                    uom: line.uom,
                    quantity: Number(line.quantity),
                    unitPrice: Number(line.unitPrice),
                    needByDate: line.needByDate,
                    proposedQuantity:
                      line.proposedQuantity == null ? null : Number(line.proposedQuantity),
                    proposedUnitPrice:
                      line.proposedUnitPrice == null ? null : Number(line.proposedUnitPrice),
                    proposedDate: line.proposedDate,
                    proposedBySupplierContact: line.proposedBySupplierContact,
                    proposedAt: line.proposedAt,
                  }}
                />
              ))}
          </div>
        </Section>
      )}

      <Section title="History">
        <Panel className="divide-y divide-rule">
          {events.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-faint">
              Nothing recorded — this order predates transition history.
            </p>
          ) : (
            [...events].reverse().map((event) => (
              <div key={event.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5 text-sm">
                <span className="font-mono text-xs tabular-nums text-ink-faint">
                  {formatDateTime(event.occurredAt)}
                </span>
                <span className="font-medium text-ink">
                  {PO_STATUS_LABEL[event.toStatus as keyof typeof PO_STATUS_LABEL] ?? event.toStatus}
                </span>
                <span className="text-ink-soft">{event.actorLabel ?? "System"}</span>
                {event.note && <span className="text-ink-faint">— {event.note}</span>}
              </div>
            ))
          )}
        </Panel>
      </Section>

      {!terminal && (
        <Section title="Danger zone">
          <CancelForm poId={po.id} number={po.number} supplierName={po.supplier.name} status={po.status} />
        </Section>
      )}

      {/* Print-only masthead and footer. A purchase order is a document that
          gets printed, signed and pinned to a shop-floor wall; neither
          competitor produces a printable artifact in any form. */}
      <div className="print-only mt-8 border-t border-rule pt-4 text-xs">
        {po.number} · {po.tenant.name} · {po.supplier.name} · printed {formatDate(new Date())}
      </div>
    </div>
  );
}
