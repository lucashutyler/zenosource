"use client";

import { useActionState } from "react";
import { chaseAll } from "@/app/actions/chase";
import { SubmitButton } from "@/components/forms";

/**
 * One chase button, at the masthead, aggregating by recipient.
 *
 * There is deliberately no per-row nudge anywhere in this product. A supplier
 * with six open lines across three orders would get six separate emails from
 * six separate clicks — on the surface we're least able to afford looking
 * careless on — and the outcome is our domain filtered, which silently ends
 * every chase we will ever send them. The cooldown behind this is server-side
 * for the same reason: a UI-only guard is one hard refresh from being gone.
 */
export function ChaseAllButton({ count }: { count: number }) {
  const [state, action] = useActionState(chaseAll, undefined);

  return (
    <form action={action} className="text-right">
      <SubmitButton pendingLabel="Sending…">Chase all {count}</SubmitButton>
      {state?.ok && (
        <p role="status" className="mt-2 max-w-xs text-xs text-ink-soft">
          {state.ok}
        </p>
      )}
      {state?.error && (
        <p role="alert" className="mt-2 max-w-xs text-xs text-age-4">
          {state.error}
        </p>
      )}
    </form>
  );
}
