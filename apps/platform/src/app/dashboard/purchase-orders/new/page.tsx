import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { locationScopeFor } from "@/lib/access";
import { PurchaseOrderForm } from "../po-form";

export default async function NewPurchaseOrderPage() {
  const user = await getCurrentInternalUser();
  if (!user) return null;

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
      mode="create"
      suppliers={suppliers}
      locations={locations.map((l) => ({ id: l.id, name: l.name, code: l.code }))}
    />
  );
}
