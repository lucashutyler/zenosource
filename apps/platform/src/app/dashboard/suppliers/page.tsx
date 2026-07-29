import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { formatCount, formatMoney, plural } from "@/lib/format";
import { pageFrom, paginationRange } from "@/lib/board";
import { EmptyState, Ledger, LinkButton, PageHeader, StatusChip, Td, Th } from "@/components/ui";
import { ListFilters, Pagination } from "@/components/list-controls";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentInternalUser();

  const q = params.q?.trim();
  const status =
    params.status === "ACTIVE" || params.status === "INACTIVE" ? params.status : undefined;

  const where: Prisma.SupplierWhereInput = {
    tenantId: user.tenantId,
    ...(status ? { status } : {}),
    ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
  };

  const total = await db.supplier.count({ where });
  const range = paginationRange(pageFrom(params), total);

  const suppliers = await db.supplier.findMany({
    where,
    include: {
      _count: {
        select: {
          contacts: { where: { status: "ACTIVE" } },
          purchaseOrders: { where: { status: { notIn: ["CLOSED", "CANCELLED"] } } },
        },
      },
    },
    orderBy: { name: "asc" },
    skip: range.skip,
    take: range.take,
  });

  // What each supplier is currently holding — the only reason to read this
  // list top to bottom rather than search it.
  const openValues = await db.purchaseOrder.groupBy({
    by: ["supplierId"],
    where: {
      tenantId: user.tenantId,
      supplierId: { in: suppliers.map((s) => s.id) },
      status: { in: ["ISSUED", "ACKNOWLEDGED", "IN_PROGRESS"] },
    },
    _sum: { totalValue: true },
  });
  const valueBySupplier = new Map(
    openValues.map((row) => [row.supplierId, Number(row._sum.totalValue ?? 0)])
  );

  return (
    <div>
      <PageHeader
        title="Suppliers"
        meta={total > 0 ? `${formatCount(total)} on file` : undefined}
        actions={
          <LinkButton href="/dashboard/suppliers/new" variant="primary">
            Add a supplier
          </LinkButton>
        }
      />

      <ListFilters
        searchPlaceholder="Supplier name"
        searchValue={q ?? ""}
        filters={[
          {
            name: "status",
            label: "Status",
            value: params.status ?? "",
            allLabel: "Active and inactive",
            options: [
              { value: "ACTIVE", label: "Active" },
              { value: "INACTIVE", label: "Inactive" },
            ],
          },
        ]}
      />

      {suppliers.length === 0 ? (
        <EmptyState
          headline={q || status ? "Nothing matches." : "No suppliers yet."}
          body="A supplier needs at least one contact before you can send them anything — that contact is who acknowledges your orders."
          action={
            <LinkButton href="/dashboard/suppliers/new" variant="primary">
              Add a supplier
            </LinkButton>
          }
        />
      ) : (
        <>
          <Ledger caption="Suppliers">
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th width="15rem">Contacts</Th>
                <Th align="right" width="7rem">
                  Live orders
                </Th>
                <Th align="right" width="9rem">
                  With them
                </Th>
                <Th width="7rem" />
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-rule/30">
                  <Td>
                    <Link
                      href={`/dashboard/suppliers/${supplier.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {supplier.name}
                    </Link>
                  </Td>
                  <Td>
                    {supplier._count.contacts === 0 ? (
                      // Not decoration: a supplier with no active contact
                      // can't be issued a PO or invited to an RFQ, and finding
                      // that out at submit time is the wrong moment.
                      <span className="text-age-3">none — can&apos;t be sent anything</span>
                    ) : (
                      <span className="text-ink-soft">
                        {supplier._count.contacts} {plural(supplier._count.contacts, "contact")}
                      </span>
                    )}
                  </Td>
                  <Td align="right" mono>
                    {supplier._count.purchaseOrders || <span className="text-ink-faint">—</span>}
                  </Td>
                  <Td align="right" mono>
                    {valueBySupplier.get(supplier.id) ? (
                      formatMoney(valueBySupplier.get(supplier.id))
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </Td>
                  <Td>
                    {supplier.status === "INACTIVE" && (
                      <StatusChip variant="settled">Inactive</StatusChip>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Ledger>
          <Pagination range={range} />
        </>
      )}
    </div>
  );
}
