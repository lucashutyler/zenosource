import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";
import { AddContactForm } from "./add-contact-form";

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentInternalUser();
  if (!user) notFound();

  const supplier = await db.supplier.findFirst({
    where: { id, tenantId: user.tenantId },
    include: { contacts: true },
  });
  if (!supplier) notFound();

  return (
    <div>
      <PageHeader
        title={supplier.name}
        subtitle={supplier.primaryContactEmail ?? undefined}
        action={<Badge tone={supplier.status === "ACTIVE" ? "success" : "neutral"}>{supplier.status.toLowerCase()}</Badge>}
      />

      <Card>
        <div className="p-4">
          <h2 className="text-sm font-medium text-zinc-950 dark:text-zinc-50">Contacts</h2>
          <p className="text-xs text-zinc-500">
            These are the people who can act on POs and RFQs for this supplier via a no-login
            emailed link.
          </p>
        </div>
        {supplier.contacts.length > 0 && (
          <ul className="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {supplier.contacts.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-zinc-950 dark:text-zinc-50">{c.name}</span>
                <span className="text-xs text-zinc-500">{c.email}</span>
              </li>
            ))}
          </ul>
        )}
        <AddContactForm supplierId={supplier.id} />
      </Card>
    </div>
  );
}
