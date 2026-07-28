import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { Card, PageHeader, LinkButton, Select } from "@/components/ui";
import type { Prisma } from "@/generated/prisma/client";

export default async function PriceListsPage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string; sort?: string }>;
}) {
  const { supplierId, sort } = await searchParams;
  const user = await getCurrentInternalUser();
  if (!user) return null;

  const suppliers = await db.supplier.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { name: "asc" },
  });

  const where: Prisma.PriceListWhereInput = {
    tenantId: user.tenantId,
    ...(supplierId ? { supplierId } : {}),
  };

  const priceLists = await db.priceList.findMany({
    where,
    include: { supplier: true, _count: { select: { items: true } } },
    orderBy: { createdAt: sort === "oldest" ? "asc" : "desc" },
  });

  return (
    <div>
      <PageHeader
        title="Price lists"
        action={<LinkButton href="/dashboard/price-lists/new">New price list</LinkButton>}
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Supplier</label>
          <Select name="supplierId" defaultValue={supplierId ?? ""}>
            <option value="">All</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Sort</label>
          <Select name="sort" defaultValue={sort ?? "newest"}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </Select>
        </div>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
        >
          Apply
        </button>
      </form>

      {priceLists.length === 0 ? (
        <p className="text-sm text-zinc-500">No price lists match these filters.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {priceLists.map((pl) => (
              <li key={pl.id}>
                <Link
                  href={`/dashboard/price-lists/${pl.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                      {pl.supplier.name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {pl._count.items} item{pl._count.items === 1 ? "" : "s"}
                      {pl.effectiveFrom || pl.effectiveTo ? (
                        <>
                          {" "}
                          · {pl.effectiveFrom ? pl.effectiveFrom.toLocaleDateString() : "—"} to{" "}
                          {pl.effectiveTo ? pl.effectiveTo.toLocaleDateString() : "—"}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <span className="text-xs text-zinc-400">{pl.createdAt.toLocaleDateString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
