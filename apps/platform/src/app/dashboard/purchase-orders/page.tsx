import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { locationScopeFor } from "@/lib/access";
import { Card, PageHeader, LinkButton, Badge, Select } from "@/components/ui";
import type { Prisma } from "@/generated/prisma/client";
import type { PurchaseOrderStatus } from "@/generated/prisma/enums";

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

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; locationId?: string; sort?: string }>;
}) {
  const { status: rawStatus, locationId, sort } = await searchParams;
  const user = await getCurrentInternalUser();
  if (!user) return null;

  // Validate against the known enum values (STATUS_TONE's keys) before it
  // reaches Prisma — a hand-edited ?status= would otherwise cast straight
  // to the enum type and 500 instead of just matching nothing.
  const status =
    rawStatus && rawStatus in STATUS_TONE ? (rawStatus as PurchaseOrderStatus) : undefined;

  const scope = await locationScopeFor(user);
  const locations = await db.location.findMany({
    where: { tenantId: user.tenantId, ...(scope ? { id: { in: scope } } : {}) },
    orderBy: { name: "asc" },
  });

  // A ?locationId= filter must narrow the caller's scope, never replace it —
  // otherwise a MEMBER could hand-edit the URL to see POs at a location
  // they aren't assigned to. An out-of-scope id resolves to an empty
  // filter set (matches nothing) rather than being honored.
  const effectiveLocationIds = locationId
    ? scope
      ? scope.includes(locationId)
        ? [locationId]
        : []
      : [locationId]
    : scope;

  const where: Prisma.PurchaseOrderWhereInput = {
    tenantId: user.tenantId,
    ...(status ? { status } : {}),
    ...(effectiveLocationIds
      ? { lines: { some: { locationId: { in: effectiveLocationIds } } } }
      : {}),
  };

  const purchaseOrders = await db.purchaseOrder.findMany({
    where,
    include: { supplier: true, lines: { include: { location: true } } },
    orderBy: { createdAt: sort === "oldest" ? "asc" : "desc" },
  });

  // "Needs your action" indicator — reads the same ActionItem records the
  // dashboard inbox does, doesn't fork the mechanism. Scoped to items this
  // specific user owns (matching the inbox's own query exactly) — without
  // this it lit up for items owned by the supplier or by a teammate, which
  // trains users to ignore a dot that's usually not actually theirs to act on.
  const openItems = await db.actionItem.findMany({
    where: {
      tenantId: user.tenantId,
      status: "OPEN",
      subjectType: "PURCHASE_ORDER",
      ownerType: "INTERNAL_USER",
      internalOwnerId: user.id,
    },
    select: { subjectId: true },
  });
  const needsAction = new Set(openItems.map((i) => i.subjectId));

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        action={<LinkButton href="/dashboard/purchase-orders/new">New PO</LinkButton>}
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Status</label>
          <Select name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {Object.keys(STATUS_TONE).map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Location</label>
          <Select name="locationId" defaultValue={locationId ?? ""}>
            <option value="">All accessible</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Sort</label>
          <Select name="sort" defaultValue={sort ?? "newest"}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </Select>
        </div>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
        >
          Apply
        </button>
      </form>

      {purchaseOrders.length === 0 ? (
        <p className="text-sm text-zinc-500">No purchase orders match these filters.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {purchaseOrders.map((po) => (
              <li key={po.id}>
                <Link
                  href={`/dashboard/purchase-orders/${po.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                      {po.supplier.name}
                      {needsAction.has(po.id) && (
                        <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-red-600 align-middle" title="Needs your action" />
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {po.lines.length} line{po.lines.length === 1 ? "" : "s"} ·{" "}
                      {[...new Set(po.lines.map((l) => l.location?.name).filter(Boolean))].join(", ") || "no location"} ·{" "}
                      {po.createdAt.toLocaleDateString()}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[po.status] ?? "neutral"}>
                    {po.status.replaceAll("_", " ").toLowerCase()}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
