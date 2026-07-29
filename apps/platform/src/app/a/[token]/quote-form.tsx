"use client";

import { useActionState, useState } from "react";
import { submitQuoteByToken } from "@/app/actions/rfqs";
import { formatDate, formatQuantity, plural } from "@/lib/format";

type Line = {
  id: string;
  itemNumber: string;
  description: string;
  uom: string;
  quantity: number;
  needByDate: string | null;
  locationName: string | null;
};

type State = { error?: string; declined?: boolean } | undefined;

const BUTTON =
  "inline-flex min-h-12 w-full items-center justify-center border px-4 py-3 text-base font-semibold disabled:opacity-50";

/**
 * Supplier-side quote submission — the largest single gap in the product.
 *
 * An invited supplier previously landed on a page headed "Submit your quote"
 * above a single **Acknowledge** button that resolved the action item having
 * supplied no price, no lead time and no quote. The comparison surface
 * therefore read "no quotes yet" forever, `RESPONSES_OPEN` was unreachable
 * through the app, and `RFQ_AWARD_DECISION` had no trigger to hook into.
 * Everything downstream of a supplier answering an RFQ was dead.
 */
export function QuoteForm({
  token,
  rfqNumber,
  tenantName,
  lines,
}: {
  token: string;
  rfqNumber: string;
  tenantName: string;
  lines: Line[];
}) {
  const [outcome, setOutcome] = useState<"none" | "quoted" | "declined">("none");

  const submit = async (_prev: State, formData: FormData): Promise<State> => {
    const result = await submitQuoteByToken(token, formData);
    if (!result.error) setOutcome(result.declined ? "declined" : "quoted");
    return result;
  };
  const [state, action, pending] = useActionState(submit, undefined);

  if (outcome === "quoted") {
    return (
      <div className="mt-6 border-t-2 border-ink pt-5">
        <h2 className="text-lg font-semibold text-ink">Quote sent.</h2>
        <p className="mt-3 text-sm text-ink-soft">
          Your company has quoted {tenantName} on{" "}
          <strong className="text-ink">{rfqNumber}</strong>. They&apos;ll come back to you either
          way — you don&apos;t need to chase it.
        </p>
        <p className="mt-4 text-sm text-ink-faint">You can close this page.</p>
      </div>
    );
  }

  if (outcome === "declined") {
    return (
      <div className="mt-6 border-t-2 border-ink pt-5">
        <h2 className="text-lg font-semibold text-ink">Declined.</h2>
        <p className="mt-3 text-sm text-ink-soft">
          {tenantName} knows you&apos;re not quoting {rfqNumber}, and you won&apos;t be chased
          about it again.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="mt-6">
      <p className="text-sm text-ink-soft">
        Price the lines you can supply. Leave a line blank if you can&apos;t — a partial quote is
        still worth sending.
      </p>

      <div className="mt-4 space-y-4">
        {lines.map((line) => (
          <fieldset key={line.id} className="border border-rule p-3">
            <legend className="px-1 text-sm">
              <span className="font-mono font-medium">{line.itemNumber}</span>{" "}
              <span className="text-ink-soft">{line.description}</span>
            </legend>
            <p className="mb-3 text-sm text-ink">
              <span className="font-mono font-semibold">
                {formatQuantity(line.quantity)} {line.uom}
              </span>
              {line.needByDate && (
                <span className="ml-2 text-ink-soft">needed {formatDate(line.needByDate)}</span>
              )}
              {line.locationName && (
                <span className="ml-2 text-ink-faint">to {line.locationName}</span>
              )}
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor={`price-${line.id}`} className="mb-1 block text-xs text-ink-faint">
                  Your unit price
                </label>
                <input
                  id={`price-${line.id}`}
                  name={`price-${line.id}`}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="min-h-11 w-full border border-rule-strong bg-paper-raised px-3 py-2 font-mono text-sm text-ink"
                />
              </div>
              <div>
                <label htmlFor={`lead-${line.id}`} className="mb-1 block text-xs text-ink-faint">
                  Lead time (days)
                </label>
                <input
                  id={`lead-${line.id}`}
                  name={`lead-${line.id}`}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  placeholder="0"
                  className="min-h-11 w-full border border-rule-strong bg-paper-raised px-3 py-2 font-mono text-sm text-ink"
                />
              </div>
              <div>
                <label htmlFor={`notes-${line.id}`} className="mb-1 block text-xs text-ink-faint">
                  Anything they should know
                </label>
                <input
                  id={`notes-${line.id}`}
                  name={`notes-${line.id}`}
                  type="text"
                  className="min-h-11 w-full border border-rule-strong bg-paper-raised px-3 py-2 text-sm text-ink"
                />
              </div>
            </div>
          </fieldset>
        ))}
      </div>

      {state?.error && (
        <p role="alert" className="mt-4 border-l-2 border-age-4 bg-paper px-3 py-2 text-sm text-ink">
          {state.error}
        </p>
      )}

      <div className="mt-5 space-y-2">
        <button
          type="submit"
          name="intent"
          value="quote"
          disabled={pending}
          className={`${BUTTON} border-ink bg-ink text-paper`}
        >
          {pending ? "Sending…" : `Send my quote to ${tenantName}`}
        </button>

        {/* A native disclosure, not a state-swapped button.

            Two reasons, both learned the hard way. React reuses the same
            `<button>` DOM node when a conditional only swaps its label and
            type, so a single click would land mousedown on the trigger and
            mouseup on the freshly-`type="submit"` element — declining outright
            and skipping the confirmation the supplier never saw. And this is
            the one surface in the product that has to work before hydration:
            it arrives from an email, on a phone, often on a shop floor. A
            `<details>` needs no JavaScript at all. */}
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center px-4 py-2 text-sm text-ink-soft underline-offset-2 hover:underline">
            I&apos;m not quoting this one
          </summary>
          <div className="mt-2">
            <p className="mb-2 text-sm text-ink-soft">
              {tenantName} will be told you&apos;re not bidding, and won&apos;t chase you about it
              again.
            </p>
            <button
              type="submit"
              name="intent"
              value="decline"
              disabled={pending}
              className={`${BUTTON} border-rule-strong bg-paper-raised text-ink`}
            >
              Yes — tell them I&apos;m not quoting{" "}
              {plural(lines.length, "this line", "these lines")}
            </button>
          </div>
        </details>
      </div>
    </form>
  );
}
