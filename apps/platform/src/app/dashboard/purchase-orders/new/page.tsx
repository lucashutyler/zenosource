import type { Metadata } from "next";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { locationScopeFor } from "@/lib/access";
import { loadPriceSchedules } from "@/lib/price-schedules";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { PurchaseOrderForm } from "../po-form";

export const metadata: Metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage() {
  const user = await getCurrentInternalUser();

  const scope = await locationScopeFor(user);
  const [suppliers, locations, schedules] = await Promise.all([
    db.supplier.findMany({
      where: { tenantId: user.tenantId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.location.findMany({
      where: { tenantId: user.tenantId, status: "ACTIVE", ...(scope ? { id: { in: scope } } : {}) },
      orderBy: { name: "asc" },
    }),
    loadPriceSchedules(user.tenantId),
  ]);

  // A form that can't be completed shouldn't be rendered in full and then
  // refuse on submit — the audit found exactly that pattern on the location
  // form, and it's the same failure here.
  if (suppliers.length === 0 || locations.length === 0) {
    return (
      <div>
        <PageHeader
          back={{ href: "/dashboard/purchase-orders", label: "All purchase orders" }}
          title="Raise a purchase order"
        />
        <EmptyState
          headline={
            suppliers.length === 0
              ? "No suppliers on file yet."
              : "No locations you can order for."
          }
          body={
            suppliers.length === 0
              ? "Every purchase order goes to a supplier, and every supplier needs a contact who can acknowledge it. Add one first."
              : "Purchase order lines are scoped to a location. An owner needs to create one, or assign you to an existing one."
          }
          action={
            suppliers.length === 0 ? (
              <LinkButton href="/dashboard/suppliers/new" variant="primary">
                Add a supplier
              </LinkButton>
            ) : user.role === "OWNER" ? (
              <LinkButton href="/dashboard/locations/new" variant="primary">
                Add a location
              </LinkButton>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <PurchaseOrderForm
      mode="create"
      suppliers={suppliers}
      locations={locations.map((l) => ({ id: l.id, name: l.name, code: l.code }))}
      schedules={schedules}
    />
  );
}
