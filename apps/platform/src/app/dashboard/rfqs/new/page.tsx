import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { RFQForm } from "../rfq-form";

export default async function NewRFQPage() {
  const user = await getCurrentInternalUser();
  if (!user) return null;

  const [suppliers, locations] = await Promise.all([
    db.supplier.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: "asc" } }),
    db.location.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: "asc" } }),
  ]);

  return (
    <RFQForm
      suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
      locations={locations.map((l) => ({ id: l.id, name: l.name, code: l.code }))}
    />
  );
}
