"use client";

import { useEffect } from "react";
import { EmptyState, LinkButton } from "@/components/ui";

/**
 * Something threw. Before this, every unhandled error rendered the bare
 * Next.js framework page — no navigation, no way back, and identical for a
 * lost database connection and a genuine bug.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // No error service is wired up yet (no hosting platform chosen — see
    // docs/todo.md's open questions). The digest is the only handle anyone
    // has on a production failure, so at minimum it goes to the console.
    console.error("dashboard error", error.digest, error);
  }, [error]);

  return (
    <EmptyState
      headline="That didn't load."
      body={
        <>
          Something went wrong on our side, not yours — nothing you were doing has been lost.
          {error.digest && (
            <>
              {" "}
              Quote <span className="font-mono text-ink">{error.digest}</span> if you report it.
            </>
          )}
        </>
      }
      action={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center border border-ink bg-ink px-3 py-2 text-sm font-medium text-paper"
          >
            Try again
          </button>
          <LinkButton href="/dashboard">Back to the chase</LinkButton>
        </div>
      }
    />
  );
}
