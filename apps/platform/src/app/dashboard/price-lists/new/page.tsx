import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { NewPriceListForm } from "./new-price-list-form";

export default async function NewPriceListPage() {
  const user = await getCurrentInternalUser();
  if (!user) return null;

  const suppliers = await db.supplier.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { name: "asc" },
  });

  return <NewPriceListForm suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} />;
}
