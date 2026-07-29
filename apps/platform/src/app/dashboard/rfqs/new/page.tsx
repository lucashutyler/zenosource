import type { Metadata } from "next";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { locationScopeFor } from "@/lib/access";
import { RFQForm } from "../rfq-form";

export const metadata: Metadata = { title: "New RFQ" };

export default async function NewRFQPage() {
  const user = await getCurrentInternalUser();
  const scope = await locationScopeFor(user);

  const [suppliers, locations] = await Promise.all([
    db.supplier.findMany({
      where: { tenantId: user.tenantId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        // Whether a supplier can be asked at all is a property of the row,
        // shown on the row — rather than a submit-time rejection listing
        // names the user then has to go and fix one at a time.
        _count: { select: { contacts: { where: { status: "ACTIVE" } } } },
      },
    }),
    db.location.findMany({
      where: { tenantId: user.tenantId, status: "ACTIVE", ...(scope ? { id: { in: scope } } : {}) },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <RFQForm
      suppliers={suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        contactCount: s._count.contacts,
      }))}
      locations={locations.map((l) => ({ id: l.id, name: l.name, code: l.code }))}
    />
  );
}
