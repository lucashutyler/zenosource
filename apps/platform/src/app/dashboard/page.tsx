import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import {
  listOpenActionItemsForInternalUser,
  listOpenExternalActionItems,
  resolveActionItemContext,
  chaseRank,
  type ActionItemContext,
} from "@/lib/action-items";
import { locationScopeFor } from "@/lib/access";
import { ACTION_COPY } from "@/lib/lifecycle";
import { formatCount, formatMoneyCompact, plural } from "@/lib/format";
import type { ActionItemType } from "@/generated/prisma/enums";
import {
  Dwell,
  EmptyState,
  Ledger,
  LinkButton,
  Money,
  DocNumber,
  Section,
  Td,
  Th,
} from "@/components/ui";
import { ChaseAllButton } from "./chase-all-button";

export const metadata: Metadata = { title: "The chase" };

export default async function DashboardPage() {
  const user = await getCurrentInternalUser();

  const [mine, theirs, scope] = await Promise.all([
    listOpenActionItemsForInternalUser(user.id),
    listOpenExternalActionItems(user.tenantId),
    locationScopeFor(user),
  ]);

  const context = await resolveActionItemContext([...mine, ...theirs]);

  // Rank by dwell x value, not dwell — the third standing law. A 40-day-old
  // $200 order and a 4-day-old $80,000 order rendered identically before
  // this, and every buyer alive chases the second one first.
  const rank = (item: { id: string; openedAt: Date }) =>
    chaseRank(item, context.get(item.id)?.value ?? null);
  const myWork = [...mine].sort((a, b) => rank(b) - rank(a));
  const theirWork = [...theirs].sort((a, b) => rank(b) - rank(a));

  const theirValue = theirWork.reduce((sum, i) => sum + (context.get(i.id)?.value ?? 0), 0);

  // What a MEMBER with an empty board can still see, so "nothing here" and
  // "nothing you're allowed to see" are distinguishable. Casey's entire first
  // impression of this product was a blank page while fifteen in-scope orders
  // sat one click away in her own list.
  const inScopePOs = await db.purchaseOrder.count({
    where: {
      tenantId: user.tenantId,
      status: { notIn: ["CLOSED", "CANCELLED"] },
      ...(scope ? { lines: { some: { locationId: { in: scope } } } } : {}),
    },
  });

  return (
    <div>
      {/* The headline. The product exists to answer one question — whose court
          is the ball in — and this is that answer, at display size, before
          anything else on the screen. The "they owe" half did not exist
          anywhere in the product before Phase 1b. */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-5">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            You owe <span className="font-mono tabular-nums">{myWork.length}</span>.{" "}
            <span className="text-court-them">
              They owe <span className="font-mono tabular-nums">{theirWork.length}</span>.
            </span>
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            {theirValue > 0 ? (
              <>
                <span className="font-mono font-medium text-ink">
                  {formatMoneyCompact(theirValue)}
                </span>{" "}
                is sitting with suppliers.
              </>
            ) : (
              "Nothing is sitting with a supplier."
            )}
          </p>
        </div>
        {theirWork.length > 0 && <ChaseAllButton count={theirWork.length} />}
      </div>

      <Section
        title="Your court"
        description={
          myWork.length > 0 ? "Hottest first — dwell weighted by what's at stake." : undefined
        }
      >
        {myWork.length === 0 ? (
          <EmptyState
            headline="Board clear."
            body={
              inScopePOs > 0 ? (
                <>
                  {formatCount(inScopePOs)} live {plural(inScopePOs, "purchase order")} in your
                  locations, none waiting on anyone.
                </>
              ) : (
                "Nothing is waiting on you, and nothing is in flight in your locations."
              )
            }
            action={<LinkButton href="/dashboard/purchase-orders">Open the ledger</LinkButton>}
          />
        ) : (
          <WorkTable items={myWork} context={context} owned />
        )}
      </Section>

      <Section
        title="Their court"
        description={
          theirWork.length > 0
            ? "Waiting on suppliers. Chasing aggregates by recipient, never per row."
            : undefined
        }
      >
        {theirWork.length === 0 ? (
          <EmptyState
            headline="Nothing outstanding with any supplier."
            body="Every order and request you've sent has been answered."
          />
        ) : (
          <WorkTable items={theirWork} context={context} />
        )}
      </Section>
    </div>
  );
}

type WorkItem = {
  id: string;
  actionType: ActionItemType;
  openedAt: Date;
  reminderCount: number;
};

function WorkTable({
  items,
  context,
  owned = false,
}: {
  items: WorkItem[];
  context: Map<string, ActionItemContext>;
  owned?: boolean;
}) {
  return (
    <Ledger caption={owned ? "Open items assigned to you" : "Open items with suppliers"}>
      <thead>
        <tr>
          <Th width="7.5rem">№</Th>
          <Th>What&apos;s owed</Th>
          <Th width="11rem">{owned ? "Supplier" : "Who owes it"}</Th>
          <Th align="right" width="6rem">
            Waiting
          </Th>
          <Th align="right" width="7rem">
            Value
          </Th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const ctx = context.get(item.id);
          const copy = ACTION_COPY[item.actionType];
          return (
            <tr key={item.id} className="hover:bg-rule/30">
              <Td mono>
                {ctx?.href ? (
                  <Link href={ctx.href} className="underline-offset-2 hover:underline">
                    <DocNumber>{ctx.identifier ?? "—"}</DocNumber>
                  </Link>
                ) : (
                  <DocNumber>{ctx?.identifier ?? "—"}</DocNumber>
                )}
              </Td>
              <Td>
                <span className="font-medium">{copy?.label ?? item.actionType}</span>
                {ctx?.detail && <span className="ml-2 text-ink-faint">{ctx.detail}</span>}
              </Td>
              <Td>
                {/* In your court the answer to "who" is always you, so the
                    column carries the supplier as context instead. In their
                    court it's the party that owes, in cobalt. */}
                <span className={owned ? "text-ink-soft" : "text-court-them"}>
                  {ctx?.supplierName ?? (owned ? "—" : "Supplier")}
                </span>
                {!owned && item.reminderCount > 0 && (
                  <span
                    className="ml-2 font-mono text-xs text-ink-faint"
                    title="How many times we've chased. Deliberately never shown to the supplier."
                  >
                    chased {item.reminderCount}×
                  </span>
                )}
              </Td>
              <Td align="right">
                <Dwell since={item.openedAt} owned={owned} />
              </Td>
              <Td align="right" mono>
                {ctx?.value != null ? (
                  <Money value={ctx.value} />
                ) : (
                  <span className="text-ink-faint">—</span>
                )}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Ledger>
  );
}
