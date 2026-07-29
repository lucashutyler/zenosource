import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { setSupplierStatus } from "@/app/actions/suppliers";
import { PO_STATUS_LABEL, RFQ_STATUS_LABEL } from "@/lib/lifecycle";
import { formatDate, plural } from "@/lib/format";
import {
  DateText,
  DocNumber,
  Ledger,
  LinkButton,
  MetaList,
  Money,
  PageHeader,
  Panel,
  Section,
  StatusChip,
  Td,
  Th,
} from "@/components/ui";
import { SimpleAction } from "@/components/simple-action";
import { AddContactForm } from "./add-contact-form";
import { ContactRow } from "./contact-row";
import { SupplierDetailsForm } from "./details-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supplier = await db.supplier.findUnique({ where: { id }, select: { name: true } });
  return { title: supplier?.name ?? "Supplier" };
}

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentInternalUser();

  const supplier = await db.supplier.findFirst({
    where: { id, tenantId: user.tenantId },
    include: { contacts: { orderBy: [{ status: "asc" }, { name: "asc" }] } },
  });
  if (!supplier) notFound();

  // Related records. The page used to be a dead end listing contacts — the
  // one question anyone opens a supplier page to answer ("what have we got
  // running with them?") had no answer anywhere in the product.
  const [purchaseOrders, rfqs, priceLists] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { supplierId: supplier.id, tenantId: user.tenantId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 10,
      select: { id: true, number: true, status: true, totalValue: true, updatedAt: true },
    }),
    db.rFQ.findMany({
      where: { tenantId: user.tenantId, invites: { some: { supplierId: supplier.id } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, number: true, status: true, updatedAt: true },
    }),
    db.priceList.findMany({
      where: { supplierId: supplier.id, tenantId: user.tenantId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        number: true,
        effectiveFrom: true,
        effectiveTo: true,
        _count: { select: { items: true } },
      },
    }),
  ]);

  const activeContacts = supplier.contacts.filter((c) => c.status === "ACTIVE");

  return (
    <div>
      <PageHeader
        back={{ href: "/dashboard/suppliers", label: "All suppliers" }}
        eyebrow="Supplier"
        title={supplier.name}
        meta={
          <MetaList>
            {[
              supplier.status === "INACTIVE" ? (
                <StatusChip key="s" variant="settled">
                  Inactive
                </StatusChip>
              ) : null,
              <span key="c">
                {activeContacts.length} active {plural(activeContacts.length, "contact")}
              </span>,
              <span key="p">
                {purchaseOrders.length} recent {plural(purchaseOrders.length, "order")}
              </span>,
            ].filter(Boolean) as React.ReactNode[]}
          </MetaList>
        }
        actions={
          <SimpleAction
            action={setSupplierStatus.bind(null, supplier.id, supplier.status === "INACTIVE")}
            label={supplier.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
            variant="quiet"
            confirm={
              supplier.status === "ACTIVE"
                ? {
                    title: `Deactivate ${supplier.name}?`,
                    body: "They stop appearing when you raise an order or an RFQ. Everything already in flight keeps running and keeps being chased — this isn't a way to stop that.",
                    confirmLabel: "Deactivate",
                  }
                : undefined
            }
          />
        }
      />

      <Section title="Details">
        <SupplierDetailsForm supplier={supplier} />
      </Section>

      <Section
        title="Contacts"
        description="The people who receive the no-login link and act on your orders. A reminder sent to somebody who has left is how a chase silently stops working."
      >
        <Panel className="divide-y divide-rule">
          {supplier.contacts.map((contact) => (
            <ContactRow key={contact.id} contact={contact} />
          ))}
          <AddContactForm supplierId={supplier.id} />
        </Panel>
      </Section>

      <Section
        title="Purchase orders"
        actions={
          <LinkButton href={`/dashboard/purchase-orders?supplierId=${supplier.id}`}>
            See all
          </LinkButton>
        }
      >
        {purchaseOrders.length === 0 ? (
          <Panel className="px-4 py-3 text-sm text-ink-faint">Nothing raised with them yet.</Panel>
        ) : (
          <Ledger caption={`Recent purchase orders with ${supplier.name}`}>
            <thead>
              <tr>
                <Th width="8rem">№</Th>
                <Th>Status</Th>
                <Th align="right" width="9rem">
                  Value
                </Th>
                <Th align="right" width="8rem">
                  Last moved
                </Th>
              </tr>
            </thead>
            <tbody>
              {purchaseOrders.map((po) => (
                <tr key={po.id} className="hover:bg-rule/30">
                  <Td mono>
                    <Link
                      href={`/dashboard/purchase-orders/${po.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      <DocNumber>{po.number}</DocNumber>
                    </Link>
                  </Td>
                  <Td>
                    <StatusChip
                      variant={
                        po.status === "CLOSED" || po.status === "CANCELLED" ? "settled" : "live"
                      }
                    >
                      {PO_STATUS_LABEL[po.status]}
                    </StatusChip>
                  </Td>
                  <Td align="right" mono>
                    <Money value={po.totalValue} />
                  </Td>
                  <Td align="right">
                    <DateText value={po.updatedAt} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Ledger>
        )}
      </Section>

      <Section title="Requests for quote">
        {rfqs.length === 0 ? (
          <Panel className="px-4 py-3 text-sm text-ink-faint">
            They haven&apos;t been asked to quote anything.
          </Panel>
        ) : (
          <Ledger caption={`Requests for quote involving ${supplier.name}`}>
            <thead>
              <tr>
                <Th width="8rem">№</Th>
                <Th>Status</Th>
                <Th align="right" width="8rem">
                  Last moved
                </Th>
              </tr>
            </thead>
            <tbody>
              {rfqs.map((rfq) => (
                <tr key={rfq.id} className="hover:bg-rule/30">
                  <Td mono>
                    <Link
                      href={`/dashboard/rfqs/${rfq.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      <DocNumber>{rfq.number}</DocNumber>
                    </Link>
                  </Td>
                  <Td>
                    <StatusChip variant={rfq.status === "CLOSED" ? "settled" : "live"}>
                      {RFQ_STATUS_LABEL[rfq.status]}
                    </StatusChip>
                  </Td>
                  <Td align="right">
                    <DateText value={rfq.updatedAt} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Ledger>
        )}
      </Section>

      <Section
        title="Price lists"
        actions={<LinkButton href="/dashboard/price-lists/new">New price list</LinkButton>}
      >
        {priceLists.length === 0 ? (
          <Panel className="px-4 py-3 text-sm text-ink-faint">
            No negotiated prices on file — every order line for this supplier is priced by hand.
          </Panel>
        ) : (
          <Panel className="divide-y divide-rule">
            {priceLists.map((list) => (
              <Link
                key={list.id}
                href={`/dashboard/price-lists/${list.id}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-rule/30"
              >
                <span>
                  <DocNumber>{list.number}</DocNumber>
                  <span className="ml-3 text-ink-soft">
                    {list._count.items} {plural(list._count.items, "part")}
                  </span>
                </span>
                <span className="text-ink-faint">
                  {list.effectiveFrom || list.effectiveTo
                    ? `${list.effectiveFrom ? formatDate(list.effectiveFrom) : "always"} → ${
                        list.effectiveTo ? formatDate(list.effectiveTo) : "open-ended"
                      }`
                    : "no dates set"}
                </span>
              </Link>
            ))}
          </Panel>
        )}
      </Section>
    </div>
  );
}
