import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/dal";
import {
  SCORECARD_WINDOW_DAYS,
  buyerScorecard,
  rfqCycleTimeHours,
  supplierScorecard,
} from "@/lib/scorecards";
import { formatMoney, formatMoneyCompact } from "@/lib/format";
import {
  EmptyState,
  Ledger,
  LinkButton,
  PageHeader,
  Panel,
  Section,
  Td,
  Th,
} from "@/components/ui";

export const metadata: Metadata = { title: "Scorecards" };

/**
 * Two fixed scorecards, one fixed window, one fixed metric list.
 *
 * No report builder and no metric picker — docs/product.md says
 * configurability is a cost, and reporting is where that discipline is
 * hardest and matters most: a number two people can define differently is a
 * number neither of them will act on.
 */
export default async function ReportsPage() {
  const user = await getCurrentInternalUser();

  const [suppliers, buyers, cycleTime] = await Promise.all([
    supplierScorecard(user.tenantId),
    buyerScorecard(user.tenantId),
    rfqCycleTimeHours(user.tenantId),
  ]);

  const active = suppliers.filter((s) => s.ordersIssued > 0 || s.rfqsInvited > 0);
  const withHistory = active.filter((s) => s.firstChaseSuccessPct != null);
  const overallFirstChase =
    withHistory.length > 0
      ? withHistory.reduce((sum, s) => sum + (s.firstChaseSuccessPct ?? 0), 0) / withHistory.length
      : null;
  const totalOutstanding = suppliers.reduce((sum, s) => sum + s.openValue, 0);

  return (
    <div>
      <PageHeader
        title="Scorecards"
        meta={`Last ${SCORECARD_WINDOW_DAYS} days. Every figure below is derived from the state machines and the transition log — there is nothing to configure, on purpose.`}
      />

      {/* The renewal sentence, at the top, because it's the one a customer
          repeats to their own management. Computable from ActionItem history
          alone — no ML, no new tables. */}
      <div className="mb-8 grid gap-4 border-b-2 border-ink pb-6 sm:grid-cols-3">
        <Headline
          value={overallFirstChase == null ? "—" : `${Math.round(overallFirstChase)}%`}
          label="answered without a second chase"
          detail={
            overallFirstChase == null
              ? "Nothing resolved in the window yet."
              : `Across ${withHistory.length} supplier${withHistory.length === 1 ? "" : "s"}.`
          }
        />
        <Headline
          value={formatMoneyCompact(totalOutstanding)}
          label="sitting with suppliers"
          detail="Value of orders nobody has answered."
        />
        <Headline
          value={cycleTime == null ? "—" : `${Math.round(cycleTime / 24)}d`}
          label="RFQ send to award"
          detail={cycleTime == null ? "No awards in the window." : "Median."}
        />
      </div>

      <Section
        title="Suppliers"
        description="Ranked by what they're holding. Acknowledgment latency and on-time delivery are the two that predict everything else."
      >
        {active.length === 0 ? (
          <EmptyState
            headline="Nothing to score yet."
            body={`No orders were issued and no RFQs sent in the last ${SCORECARD_WINDOW_DAYS} days.`}
            action={
              <LinkButton href="/dashboard/purchase-orders/new" variant="primary">
                Raise a purchase order
              </LinkButton>
            }
          />
        ) : (
          <Ledger caption="Supplier scorecard">
            <thead>
              <tr>
                <Th width="14rem">Supplier</Th>
                <Th align="right" width="6rem">Ack</Th>
                <Th align="right" width="6rem">On time</Th>
                <Th align="right" width="7rem">Changes</Th>
                <Th align="right" width="6rem">Quotes</Th>
                <Th align="right" width="7rem">1st chase</Th>
                <Th align="right" width="7rem">Waiting</Th>
                <Th align="right" width="8rem">Holding</Th>
              </tr>
            </thead>
            <tbody>
              {[...active]
                .sort((a, b) => b.openValue - a.openValue)
                .map((s) => (
                  <tr key={s.supplierId} className="hover:bg-rule/30">
                    <Td>
                      <Link
                        href={`/dashboard/suppliers/${s.supplierId}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {s.name}
                      </Link>
                      <span className="block text-xs text-ink-faint">
                        {s.ordersIssued} issued
                        {s.ordersRejected > 0 ? `, ${s.ordersRejected} rejected` : ""}
                      </span>
                    </Td>
                    <Td align="right" mono>
                      {s.ackLatencyHours == null ? (
                        <Dash />
                      ) : s.ackLatencyHours < 24 ? (
                        `${Math.round(s.ackLatencyHours)}h`
                      ) : (
                        `${Math.round(s.ackLatencyHours / 24)}d`
                      )}
                    </Td>
                    <Td align="right" mono>
                      {s.onTimePct == null ? <Dash /> : `${Math.round(s.onTimePct)}%`}
                    </Td>
                    <Td align="right" mono>
                      {s.changeProposalPct == null ? (
                        <Dash />
                      ) : (
                        <>
                          {Math.round(s.changeProposalPct)}%
                          {s.averageDateSlipDays != null && (
                            <span className="block text-xs font-normal text-ink-faint">
                              +{Math.round(s.averageDateSlipDays)}d avg
                            </span>
                          )}
                        </>
                      )}
                    </Td>
                    <Td align="right" mono>
                      {s.rfqsInvited === 0 ? (
                        <Dash />
                      ) : (
                        <>
                          {s.rfqsQuoted}/{s.rfqsInvited}
                          {s.quoteTurnaroundHours != null && (
                            <span className="block text-xs font-normal text-ink-faint">
                              {Math.round(s.quoteTurnaroundHours / 24)}d
                            </span>
                          )}
                        </>
                      )}
                    </Td>
                    <Td align="right" mono>
                      {s.firstChaseSuccessPct == null ? (
                        <Dash />
                      ) : (
                        `${Math.round(s.firstChaseSuccessPct)}%`
                      )}
                    </Td>
                    <Td align="right" mono>
                      {s.openItems === 0 ? (
                        <Dash />
                      ) : (
                        <>
                          {s.openItems}
                          {s.oldestOpenDays != null && (
                            <span className="block text-xs font-normal text-ink-faint">
                              oldest {Math.round(s.oldestOpenDays)}d
                            </span>
                          )}
                        </>
                      )}
                    </Td>
                    <Td align="right" mono>
                      {s.openValue > 0 ? formatMoney(s.openValue) : <Dash />}
                    </Td>
                  </tr>
                ))}
            </tbody>
          </Ledger>
        )}
      </Section>

      <Section
        title="Your team"
        description="How fast work assigned to each person actually moves. Not a productivity scoreboard — the only actionable number here is the age of the oldest thing somebody is sitting on."
      >
        <Ledger caption="Buyer scorecard">
          <thead>
            <tr>
              <Th width="14rem">Person</Th>
              <Th align="right" width="8rem">Median to resolve</Th>
              <Th align="right" width="7rem">Resolved</Th>
              <Th align="right" width="7rem">Open</Th>
              <Th align="right" width="8rem">Oldest open</Th>
              <Th align="right" width="9rem">Draft to issue</Th>
            </tr>
          </thead>
          <tbody>
            {buyers.map((b) => (
              <tr key={b.internalUserId}>
                <Td>{b.name}</Td>
                <Td align="right" mono>
                  {b.resolutionLatencyHours == null ? (
                    <Dash />
                  ) : b.resolutionLatencyHours < 24 ? (
                    `${Math.round(b.resolutionLatencyHours)}h`
                  ) : (
                    `${Math.round(b.resolutionLatencyHours / 24)}d`
                  )}
                </Td>
                <Td align="right" mono>
                  {b.resolved || <Dash />}
                </Td>
                <Td align="right" mono>
                  {b.open || <Dash />}
                </Td>
                <Td align="right" mono>
                  {b.oldestOpenDays == null ? <Dash /> : `${Math.round(b.oldestOpenDays)}d`}
                </Td>
                <Td align="right" mono>
                  {b.draftToIssueHours == null ? (
                    <Dash />
                  ) : b.draftToIssueHours < 24 ? (
                    `${Math.round(b.draftToIssueHours)}h`
                  ) : (
                    `${Math.round(b.draftToIssueHours / 24)}d`
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Ledger>
      </Section>

      <Panel className="px-4 py-3 text-sm text-ink-soft">
        A dash means there wasn&apos;t enough history to compute the figure honestly — it is never
        a zero.
      </Panel>
    </div>
  );
}

function Headline({
  value,
  label,
  detail,
}: {
  value: string;
  label: string;
  detail: string;
}) {
  return (
    <div>
      <p className="font-mono text-3xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-sm font-medium text-ink">{label}</p>
      <p className="mt-0.5 text-xs text-ink-faint">{detail}</p>
    </div>
  );
}

function Dash() {
  return <span className="text-ink-faint">—</span>;
}
