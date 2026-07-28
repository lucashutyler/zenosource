import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { Card, PageHeader, LinkButton } from "@/components/ui";

export default async function SuppliersPage() {
  const user = await getCurrentInternalUser();
  const suppliers = user
    ? await db.supplier.findMany({
        where: { tenantId: user.tenantId },
        orderBy: { name: "asc" },
      })
    : [];

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle="Every buyer decision below assumes a supplier already exists here."
        action={<LinkButton href="/dashboard/suppliers/new">Add supplier</LinkButton>}
      />

      {suppliers.length === 0 ? (
        <p className="text-sm text-zinc-500">No suppliers yet.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {suppliers.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/dashboard/suppliers/${s.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                      {s.name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {s.primaryContactEmail ?? "no primary contact"}
                    </p>
                  </div>
                  <span className="text-xs text-zinc-400">{s.status.toLowerCase()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
