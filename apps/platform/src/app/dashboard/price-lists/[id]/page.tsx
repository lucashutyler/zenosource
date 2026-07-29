import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { deletePriceList, deletePriceListItem, duplicatePriceList } from "@/app/actions/price-lists";
import { formatCount, plural, todayUTC } from "@/lib/format";
import {
  DocNumber,
  Ledger,
  MetaList,
  PageHeader,
  Panel,
  Section,
  StatusChip,
  Td,
  Th,
} from "@/components/ui";
import { SimpleAction } from "@/components/simple-action";
import { AddItemForm } from "./add-item-form";
import { AddPriceBreakForm } from "./add-price-break-form";
import { PriceBreakRow } from "./price-break-row";
import { PriceListDetailsForm } from "./details-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const list = await db.priceList.findUnique({
    where: { id },
    select: { number: true, supplier: { select: { name: true } } },
  });
  return { title: list ? `${list.number} · ${list.supplier.name}` : "Price list" };
}

export default async function PriceListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentInternalUser();

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

  const suppliers = await db.supplier.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const today = todayUTC();
  const expired = priceList.effectiveTo && priceList.effectiveTo < today;
  const notYet = priceList.effectiveFrom && priceList.effectiveFrom > today;

  return (
    <div>
      <PageHeader
        back={{ href: "/dashboard/price-lists", label: "All price lists" }}
        eyebrow="Price list"
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            <DocNumber className="text-2xl">{priceList.number}</DocNumber>
            <span className="text-lg font-normal text-ink-soft">{priceList.supplier.name}</span>
          </span>
        }
        meta={
          <MetaList>
            {[
              expired ? (
                <StatusChip key="s" variant="settled">
                  Expired
                </StatusChip>
              ) : notYet ? (
                <StatusChip key="s" variant="live">
                  Not yet live
                </StatusChip>
              ) : (
                <span key="s" className="text-settled">
                  In force
                </span>
              ),
              <span key="i">
                {formatCount(priceList.items.length)} {plural(priceList.items.length, "part")}
              </span>,
              <span key="c">USD</span>,
            ].filter(Boolean) as React.ReactNode[]}
          </MetaList>
        }
        actions={
          <>
            <SimpleAction
              action={duplicatePriceList.bind(null, priceList.id)}
              label="Duplicate"
              confirm={{
                title: `Duplicate ${priceList.number}?`,
                body: "Copies every part and every price break under a new number — the usual way to start next year's schedule from this year's.",
                confirmLabel: "Create the copy",
              }}
            />
            <SimpleAction
              action={deletePriceList.bind(null, priceList.id)}
              label="Delete"
              variant="quiet"
              confirm={{
                title: `Delete ${priceList.number}?`,
                body: "Every part and price break on it goes too. Orders already priced from it keep their prices — they were copied onto the line, not looked up. If you only want it to stop applying, set an end date instead.",
                confirmLabel: "Delete it",
              }}
            />
          </>
        }
      />

      <Section title="When it applies">
        <PriceListDetailsForm priceList={priceList} suppliers={suppliers} />
      </Section>

      <Section
        title="Parts and quantity breaks"
        description="A break sets the price from that quantity up. The 'to' column is computed from the next break, so the schedule reads as bands rather than thresholds."
      >
        {priceList.items.length === 0 ? (
          <Panel className="px-4 py-3 text-sm text-ink-faint">
            Nothing priced yet. Add the first part below.
          </Panel>
        ) : (
          <Ledger caption={`Parts on ${priceList.number}`}>
            <thead>
              <tr>
                <Th width="18rem">Part</Th>
                <Th width="5rem">UOM</Th>
                <Th>Quantity bands</Th>
                <Th width="4rem" />
              </tr>
            </thead>
            <tbody>
              {priceList.items.map((item) => (
                <tr key={item.id}>
                  <Td>
                    <span className="font-mono font-medium">{item.itemNumber}</span>
                    <span className="block text-ink-soft">{item.description}</span>
                  </Td>
                  <Td>{item.uom}</Td>
                  <Td>
                    {item.priceBreaks.length > 0 && (
                      <table className="mb-2 w-full max-w-sm text-sm">
                        <caption className="sr-only">
                          Quantity bands for {item.itemNumber}
                        </caption>
                        <thead>
                          <tr className="text-[11px] uppercase tracking-wider text-ink-faint">
                            <th scope="col" className="py-1 text-left font-semibold">
                              From
                            </th>
                            <th scope="col" className="py-1 text-left font-semibold">
                              To
                            </th>
                            <th scope="col" className="py-1 text-right font-semibold">
                              Each
                            </th>
                            <th scope="col" />
                          </tr>
                        </thead>
                        <tbody>
                          {item.priceBreaks.map((priceBreak, i) => (
                            <PriceBreakRow
                              key={priceBreak.id}
                              id={priceBreak.id}
                              minQuantity={priceBreak.minQuantity}
                              // Computed `QTY TO` — the band, not the
                              // threshold. "1–249 / 250–999 / 1,000–—" is how
                              // a buyer reads a schedule; a bare list of
                              // "250+" rows makes them derive it.
                              maxQuantity={
                                item.priceBreaks[i + 1]
                                  ? item.priceBreaks[i + 1].minQuantity - 1
                                  : null
                              }
                              unitPrice={Number(priceBreak.unitPrice)}
                              deletable={item.priceBreaks.length > 1}
                            />
                          ))}
                        </tbody>
                      </table>
                    )}
                    <AddPriceBreakForm itemId={item.id} />
                  </Td>
                  <Td>
                    <SimpleAction
                      action={deletePriceListItem.bind(null, item.id)}
                      label="Remove"
                      variant="quiet"
                      confirm={{
                        title: `Remove ${item.itemNumber}?`,
                        body: "It stops pre-filling on new order lines and stops flagging off-schedule prices. Orders already raised keep the price they were given.",
                        confirmLabel: "Remove it",
                      }}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Ledger>
        )}
      </Section>

      <Section title="Add a part">
        <Panel className="p-4">
          <AddItemForm priceListId={priceList.id} />
        </Panel>
      </Section>
    </div>
  );
}
