import type { Metadata } from "next";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { NewPriceListForm } from "./new-price-list-form";

export const metadata: Metadata = { title: "New price list" };

export default async function NewPriceListPage() {
  const user = await getCurrentInternalUser();

  const suppliers = await db.supplier.findMany({
    where: { tenantId: user.tenantId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  if (suppliers.length === 0) {
    return (
      <div>
        <PageHeader
          back={{ href: "/dashboard/price-lists", label: "All price lists" }}
          title="New price list"
        />
        <EmptyState
          headline="No suppliers to price against."
          body="A price list belongs to one supplier — add the supplier first."
          action={
            <LinkButton href="/dashboard/suppliers/new" variant="primary">
              Add a supplier
            </LinkButton>
          }
        />
      </div>
    );
  }

  return <NewPriceListForm suppliers={suppliers} />;
}
