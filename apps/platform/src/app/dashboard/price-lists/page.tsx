import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { formatDate, plural, todayUTC } from "@/lib/format";
import { EmptyState, Ledger, LinkButton, DocNumber, PageHeader, StatusChip, Td, Th } from "@/components/ui";
import { ListFilters } from "@/components/list-controls";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Price lists" };

export default async function PriceListsPage({
  searchParams,
}: {
  searchParams: Promise<{ supplierId?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentInternalUser();

  const suppliers = await db.supplier.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const where: Prisma.PriceListWhereInput = {
    tenantId: user.tenantId,
    ...(params.supplierId ? { supplierId: params.supplierId } : {}),
  };

  const priceLists = await db.priceList.findMany({
    where,
    include: { supplier: true, _count: { select: { items: true } } },
    orderBy: [{ supplier: { name: "asc" } }, { createdAt: "desc" }],
  });

  const today = todayUTC();

  return (
    <div>
      <PageHeader
        title="Price lists"
        meta="What you've negotiated, per supplier and per quantity. Order lines price themselves from these."
        actions={
          <LinkButton href="/dashboard/price-lists/new" variant="primary">
            New price list
          </LinkButton>
        }
      />

      <ListFilters
        filters={[
          {
            name: "supplierId",
            label: "Supplier",
            value: params.supplierId ?? "",
            allLabel: "Every supplier",
            options: suppliers.map((s) => ({ value: s.id, label: s.name })),
          },
        ]}
      />

      {priceLists.length === 0 ? (
        <EmptyState
          headline={params.supplierId ? "Nothing for that supplier." : "No price lists yet."}
          body="Without one, every purchase order line is priced from memory — and nothing tells the buyer when they've typed something other than the rate you agreed."
          action={
            <LinkButton href="/dashboard/price-lists/new" variant="primary">
              New price list
            </LinkButton>
          }
        />
      ) : (
        <Ledger caption="Price lists">
          <thead>
            <tr>
              <Th width="7.5rem">№</Th>
              <Th>Supplier</Th>
              <Th align="right" width="6rem">
                Parts
              </Th>
              <Th width="16rem">Effective</Th>
              <Th width="8rem" />
            </tr>
          </thead>
          <tbody>
            {priceLists.map((list) => {
              // "What does SKU-2050 cost today?" needs an answer, and a list
              // that expired in March silently answering it is worse than no
              // answer at all.
              const notYet = list.effectiveFrom && list.effectiveFrom > today;
              const expired = list.effectiveTo && list.effectiveTo < today;
              return (
                <tr key={list.id} className="hover:bg-rule/30">
                  <Td mono>
                    <Link
                      href={`/dashboard/price-lists/${list.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      <DocNumber>{list.number}</DocNumber>
                    </Link>
                  </Td>
                  <Td>{list.supplier.name}</Td>
                  <Td align="right" mono>
                    {list._count.items || <span className="text-ink-faint">—</span>}
                  </Td>
                  <Td>
                    <span className="text-ink-soft">
                      {list.effectiveFrom || list.effectiveTo
                        ? `${list.effectiveFrom ? formatDate(list.effectiveFrom) : "always"} → ${
                            list.effectiveTo ? formatDate(list.effectiveTo) : "open-ended"
                          }`
                        : "no dates set"}
                    </span>
                  </Td>
                  <Td>
                    {expired ? (
                      <StatusChip variant="settled">Expired</StatusChip>
                    ) : notYet ? (
                      <StatusChip variant="live">Not yet live</StatusChip>
                    ) : (
                      <span className="text-xs text-settled">In force</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Ledger>
      )}

      <p className="mt-4 text-sm text-ink-faint">
        {priceLists.length} {plural(priceLists.length, "list")} · prices are USD.
      </p>
    </div>
  );
}
