import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { locationScopeFor } from "@/lib/access";
import { PurchaseOrderForm } from "../../po-form";

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentInternalUser();
  if (!user) notFound();

  const po = await db.purchaseOrder.findFirst({
    where: { id, tenantId: user.tenantId },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  if (!po) notFound();
  if (po.status !== "DRAFT") notFound();

  const scope = await locationScopeFor(user);
  const [suppliers, locations] = await Promise.all([
    db.supplier.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: "asc" } }),
    db.location.findMany({
      where: { tenantId: user.tenantId, ...(scope ? { id: { in: scope } } : {}) },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <PurchaseOrderForm
      mode="edit"
      poId={po.id}
      suppliers={suppliers}
      locations={locations.map((l) => ({ id: l.id, name: l.name, code: l.code }))}
      initialSupplierId={po.supplierId}
      initialLines={po.lines.map((l) => ({
        itemNumber: l.itemNumber,
        description: l.description,
        uom: l.uom,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        locationId: l.locationId ?? "",
        needByDate: l.needByDate ? l.needByDate.toISOString().slice(0, 10) : "",
      }))}
    />
  );
}
