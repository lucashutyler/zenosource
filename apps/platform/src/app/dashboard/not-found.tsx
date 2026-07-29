import { EmptyState, LinkButton } from "@/components/ui";

/**
 * A record that isn't there — or is there and isn't yours.
 *
 * Deliberately the same page for both. A scope-denied MEMBER and a genuinely
 * missing record produce the same response by design: telling someone "this
 * exists but you can't see it" leaks the existence of orders at plants
 * they're not assigned to, which is precisely what the location scope is for.
 * The copy therefore has to cover both honestly without picking one.
 *
 * One trade-off, recorded because it's easy to mistake for a bug: a *nested*
 * not-found boundary renders inside the already-streamed dashboard layout, so
 * the HTTP status is 200 rather than the 404 the bare framework page returned.
 * The access-control property is unaffected — nothing about the record is
 * sent — and the E2E specs assert on that rather than on the status line. If
 * a 404 status ever matters here (monitoring, crawlers), the fix is to move
 * this boundary to the root, at the cost of losing the shell and the
 * navigation back out.
 */
export default function DashboardNotFound() {
  return (
    <EmptyState
      headline="Nothing here."
      body="This record doesn't exist, or it belongs to a location you're not assigned to. If you think you should see it, an owner can check your locations."
      action={
        <div className="flex gap-2">
          <LinkButton href="/dashboard" variant="primary">
            Back to the chase
          </LinkButton>
          <LinkButton href="/dashboard/purchase-orders">Purchase orders</LinkButton>
        </div>
      }
    />
  );
}
