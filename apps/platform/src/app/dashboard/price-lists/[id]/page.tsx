import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { duplicatePriceList } from "@/app/actions/price-lists";
import { Card, PageHeader, Badge, SubmitButton } from "@/components/ui";
import { AddItemForm } from "./add-item-form";
import { AddPriceBreakForm } from "./add-price-break-form";

export default async function PriceListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentInternalUser();
  if (!user) notFound();

  const priceList = await db.priceList.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      supplier: true,
      items: {
        orderBy: { itemNumber: "asc" },
        include: { priceBreaks: { orderBy: { minQuantity: "asc" } } },
      },
    },
  });
  if (!priceList) notFound();

  const boundDuplicate = duplicatePriceList.bind(null, priceList.id);

  const dateRange =
    priceList.effectiveFrom || priceList.effectiveTo
      ? `Effective ${priceList.effectiveFrom ? priceList.effectiveFrom.toLocaleDateString() : "—"} to ${
          priceList.effectiveTo ? priceList.effectiveTo.toLocaleDateString() : "—"
        }`
      : "No effective date range set";

  return (
    <div>
      <PageHeader
        title={priceList.supplier.name}
        subtitle={dateRange}
        action={
          <Badge>
            {priceList.items.length} item{priceList.items.length === 1 ? "" : "s"}
          </Badge>
        }
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <form action={boundDuplicate}>
          <SubmitButton variant="secondary">Duplicate</SubmitButton>
        </form>
      </div>

      {priceList.items.length > 0 && (
        <Card className="mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">UOM</th>
                <th className="px-4 py-2">Price breaks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {priceList.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 align-top">
                    <p className="font-medium text-zinc-950 dark:text-zinc-50">{item.itemNumber}</p>
                    <p className="text-xs text-zinc-500">{item.description}</p>
                  </td>
                  <td className="px-4 py-3 align-top">{item.uom}</td>
                  <td className="px-4 py-3 align-top">
                    {item.priceBreaks.length > 0 && (
                      <ul className="mb-3 space-y-1">
                        {item.priceBreaks.map((pb) => (
                          <li key={pb.id} className="text-xs text-zinc-600 dark:text-zinc-400">
                            {pb.minQuantity}+ @ {pb.unitPrice.toString()} {pb.currency}
                          </li>
                        ))}
                      </ul>
                    )}
                    <AddPriceBreakForm itemId={item.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="mb-1 text-sm font-medium text-zinc-950 dark:text-zinc-50">Add item</h2>
        <p className="mb-4 text-xs text-zinc-500">
          Adds a new item to this price list with its first price break. Add more breaks from the
          table above once it&rsquo;s created.
        </p>
        <AddItemForm priceListId={priceList.id} />
      </Card>
    </div>
  );
}
