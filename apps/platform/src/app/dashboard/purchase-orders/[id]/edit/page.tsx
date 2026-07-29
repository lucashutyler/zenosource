import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { locationScopeFor, hasLocationAccess } from "@/lib/access";
import { loadPriceSchedules } from "@/lib/price-schedules";
import { toDateInputValue } from "@/lib/format";
import { PurchaseOrderForm } from "../../po-form";

export const metadata: Metadata = { title: "Edit draft" };

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentInternalUser();

  const po = await db.purchaseOrder.findFirst({
    where: { id, tenantId: user.tenantId },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  if (!po || po.status !== "DRAFT") notFound();

  const scope = await locationScopeFor(user);
  if (!hasLocationAccess(po.lines.map((l) => l.locationId), scope)) notFound();

  const [suppliers, locations, schedules] = await Promise.all([
    db.supplier.findMany({
      where: { tenantId: user.tenantId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.location.findMany({
      where: { tenantId: user.tenantId, ...(scope ? { id: { in: scope } } : {}) },
      orderBy: { name: "asc" },
    }),
    loadPriceSchedules(user.tenantId),
  ]);

  return (
    <PurchaseOrderForm
      mode="edit"
      poId={po.id}
      suppliers={suppliers}
      locations={locations.map((l) => ({ id: l.id, name: l.name, code: l.code }))}
      schedules={schedules}
      initialSupplierId={po.supplierId}
      initialLines={po.lines.map((l) => ({
        itemNumber: l.itemNumber,
        description: l.description,
        uom: l.uom,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        locationId: l.locationId ?? "",
        needByDate: toDateInputValue(l.needByDate),
      }))}
    />
  );
}
