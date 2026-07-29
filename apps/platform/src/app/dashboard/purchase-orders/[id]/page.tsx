import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { locationScopeFor, hasLocationAccess } from "@/lib/access";
import {
  duplicatePurchaseOrder,
  acceptChangeProposal,
  rejectChangeProposal,
} from "@/app/actions/purchase-orders";
import { Card, PageHeader, Badge, LinkButton, SubmitButton } from "@/components/ui";
import { CancelForm } from "./cancel-form";
import { IssueForm } from "./issue-form";

const STATUS_TONE: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  ISSUED: "warning",
  ACKNOWLEDGED: "success",
  REJECTED: "danger",
  IN_PROGRESS: "warning",
  FULFILLED: "success",
  CLOSED: "neutral",
  CANCELLED: "danger",
};

const TERMINAL = ["FULFILLED", "CLOSED", "CANCELLED"];

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
      supplier: true,
      lines: { orderBy: { lineNumber: "asc" }, include: { location: true } },
      cancelledByUser: true,
    },
  });
  if (!po) notFound();

  const scope = await locationScopeFor(user);
  if (!hasLocationAccess(po.lines.map((l) => l.locationId), scope)) notFound();

  const boundDuplicate = duplicatePurchaseOrder.bind(null, po.id);

  return (
    <div>
      <PageHeader
        title={po.supplier.name}
        subtitle={`Created ${po.createdAt.toLocaleDateString()}`}
        action={<Badge tone={STATUS_TONE[po.status] ?? "neutral"}>{po.status.replaceAll("_", " ").toLowerCase()}</Badge>}
      />

      <div className="mb-6 flex flex-wrap gap-3">
        {po.status === "DRAFT" && (
          <>
            <LinkButton href={`/dashboard/purchase-orders/${po.id}/edit`} variant="secondary">
              Edit
            </LinkButton>
            <IssueForm poId={po.id} />
          </>
        )}
        <form action={boundDuplicate}>
          <SubmitButton variant="secondary">Duplicate</SubmitButton>
        </form>
      </div>

      {po.status === "REJECTED" && po.rejectionReason && (
        <Card className="mb-6 border-red-200 p-4 dark:border-red-900">
          <p className="text-sm text-red-700 dark:text-red-400">
            Supplier rejected: {po.rejectionReason}
          </p>
        </Card>
      )}
      {po.status === "CANCELLED" && (
        <Card className="mb-6 p-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Cancelled {po.cancelledAt?.toLocaleDateString()} by {po.cancelledByUser?.name ?? "unknown"}
            {po.cancellationReason ? ` — ${po.cancellationReason}` : ""}
          </p>
        </Card>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2">Qty</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2">Location</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {po.lines.map((line) => (
              <tr
                key={line.id}
                id={`line-${line.id}`}
                className={
                  line.id === highlight
                    ? "bg-indigo-50 ring-1 ring-inset ring-indigo-300 dark:bg-indigo-500/10 dark:ring-indigo-700"
                    : undefined
                }
              >
                <td className="px-4 py-3">
                  <p className="font-medium text-zinc-950 dark:text-zinc-50">{line.itemNumber}</p>
                  <p className="text-xs text-zinc-500">{line.description}</p>
                  {line.id === highlight && (
                    <p className="mt-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                      ← this is what your action item is about
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {line.quantity.toString()} {line.uom}
                </td>
                <td className="px-4 py-3">${line.unitPrice.toString()}</td>
                <td className="px-4 py-3">{line.location?.name ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge tone={line.status === "CHANGE_PROPOSED" ? "warning" : "neutral"}>
                    {line.status.replaceAll("_", " ").toLowerCase()}
                  </Badge>
                  {line.status === "CHANGE_PROPOSED" && (
                    <div className="mt-2 rounded-md bg-amber-50 p-2 text-xs dark:bg-amber-900/20">
                      <p className="mb-1 text-amber-800 dark:text-amber-300">
                        {line.proposedBySupplierContact} proposed: qty {line.proposedQuantity?.toString()},
                        price ${line.proposedUnitPrice?.toString()}
                        {line.proposedDate ? `, by ${line.proposedDate.toLocaleDateString()}` : ""}
                      </p>
                      <div className="flex gap-2">
                        <form action={acceptChangeProposal.bind(null, line.id)}>
                          <SubmitButton variant="secondary">Accept</SubmitButton>
                        </form>
                        <form action={rejectChangeProposal.bind(null, line.id)}>
                          <SubmitButton variant="secondary">Reject</SubmitButton>
                        </form>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {!TERMINAL.includes(po.status) && (
        <div className="mt-6">
          <Card className="p-4">
            <CancelForm poId={po.id} />
          </Card>
        </div>
      )}
    </div>
  );
}
