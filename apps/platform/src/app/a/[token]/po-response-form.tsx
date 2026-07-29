"use client";

import { useActionState, useState } from "react";
import {
  acknowledgePOByToken,
  rejectPOByToken,
  proposeChangeByToken,
} from "@/app/actions/purchase-orders";
import { formatDate, formatMoney, formatQuantity } from "@/lib/format";

type Line = {
  id: string;
  lineNumber: number;
  itemNumber: string;
  description: string;
  uom: string;
  quantity: number;
  unitPrice: number;
  needByDate: string | null;
};

type ResponseState = { error?: string } | undefined;

const BUTTON =
  "inline-flex min-h-12 w-full items-center justify-center border px-4 py-3 text-base font-semibold disabled:opacity-50";

/**
 * The supplier's three answers: yes, yes-but, no.
 *
 * "Yes-but" is the one that didn't exist. The `proposed*` columns and the
 * buyer's accept/reject screen both shipped in Phase 1 with no way for a
 * supplier to ever produce a proposal — the collaboration feature this
 * product is effectively named for was half-built and unreachable from the
 * only side that starts it.
 */
export function PoResponseForm({
  token,
  poNumber,
  tenantName,
  lines,
}: {
  token: string;
  poNumber: string;
  tenantName: string;
  lines: Line[];
}) {
  const [outcome, setOutcome] = useState<"none" | "confirmed" | "proposed" | "rejected">("none");
  const [mode, setMode] = useState<"choose" | "propose" | "reject">("choose");

  const acknowledge = async (_prev: ResponseState, formData: FormData): Promise<ResponseState> => {
    const result = await acknowledgePOByToken(token, formData);
    if (!result.error) setOutcome("confirmed");
    return result;
  };
  const propose = async (_prev: ResponseState, formData: FormData): Promise<ResponseState> => {
    const result = await proposeChangeByToken(token, formData);
    if (!result.error) setOutcome("proposed");
    return result;
  };
  const reject = async (_prev: ResponseState, formData: FormData): Promise<ResponseState> => {
    const result = await rejectPOByToken(token, formData);
    if (!result.error) setOutcome("rejected");
    return result;
  };

  const [ackState, ackAction, ackPending] = useActionState(acknowledge, undefined);
  const [propState, propAction, propPending] = useActionState(propose, undefined);
  const [rejState, rejAction, rejPending] = useActionState(reject, undefined);

  const earliest = lines
    .map((l) => l.needByDate)
    .filter((d): d is string => d != null)
    .sort()[0];
  const single = lines.length === 1 ? lines[0] : null;

  if (outcome !== "none") {
    return <Receipt outcome={outcome} poNumber={poNumber} tenantName={tenantName} lines={lines} token={token} />;
  }

  if (mode === "propose") {
    return (
      <form action={propAction} className="mt-6">
        <h2 className="text-base font-semibold text-ink">What can you do instead?</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Change only what needs changing. Anything you leave alone is accepted as ordered.
        </p>

        <div className="mt-4 space-y-4">
          {lines.map((line) => (
            <fieldset key={line.id} className="border border-rule p-3">
              <legend className="px-1 text-sm">
                <span className="font-mono font-medium">{line.itemNumber}</span>{" "}
                <span className="text-ink-soft">{line.description}</span>
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor={`proposed-quantity-${line.id}`}
                    className="mb-1 block text-xs text-ink-faint"
                  >
                    Quantity (ordered {formatQuantity(line.quantity)} {line.uom})
                  </label>
                  <input
                    id={`proposed-quantity-${line.id}`}
                    name={`proposed-quantity-${line.id}`}
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder={String(line.quantity)}
                    className="min-h-11 w-full border border-rule-strong bg-paper-raised px-3 py-2 font-mono text-sm text-ink"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`proposed-price-${line.id}`}
                    className="mb-1 block text-xs text-ink-faint"
                  >
                    Unit price (ordered {formatMoney(line.unitPrice)})
                  </label>
                  <input
                    id={`proposed-price-${line.id}`}
                    name={`proposed-price-${line.id}`}
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder={String(line.unitPrice)}
                    className="min-h-11 w-full border border-rule-strong bg-paper-raised px-3 py-2 font-mono text-sm text-ink"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`proposed-date-${line.id}`}
                    className="mb-1 block text-xs text-ink-faint"
                  >
                    Date you can make{" "}
                    {line.needByDate ? `(asked ${formatDate(line.needByDate)})` : ""}
                  </label>
                  <input
                    id={`proposed-date-${line.id}`}
                    name={`proposed-date-${line.id}`}
                    type="date"
                    defaultValue={line.needByDate?.slice(0, 10)}
                    className="min-h-11 w-full border border-rule-strong bg-paper-raised px-3 py-2 text-sm text-ink"
                  />
                </div>
              </div>
            </fieldset>
          ))}
        </div>

        <Error message={propState?.error} />

        <div className="mt-5 space-y-2">
          <button type="submit" disabled={propPending} className={`${BUTTON} border-ink bg-ink text-paper`}>
            {propPending ? "Sending…" : `Send this back to ${tenantName}`}
          </button>
          <button
            type="button"
            onClick={() => setMode("choose")}
            className={`${BUTTON} border-rule-strong bg-paper-raised text-ink`}
          >
            Back
          </button>
        </div>
      </form>
    );
  }

  if (mode === "reject") {
    return (
      <form action={rejAction} className="mt-6">
        <h2 className="text-base font-semibold text-ink">Turning this order down</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {tenantName} will be told and someone there will pick it up. If it&apos;s only the date or
          the quantity that&apos;s a problem, going back and proposing a change usually gets a
          faster answer.
        </p>
        <div className="mt-4">
          <label htmlFor="reason" className="mb-1 block text-sm font-medium text-ink">
            Why, briefly
          </label>
          <textarea
            id="reason"
            name="reason"
            rows={3}
            className="min-h-24 w-full border border-rule-strong bg-paper-raised px-3 py-2 text-sm text-ink"
          />
        </div>
        <Error message={rejState?.error} />
        <div className="mt-5 space-y-2">
          <button type="submit" disabled={rejPending} className={`${BUTTON} border-ink bg-ink text-paper`}>
            {rejPending ? "Sending…" : "Turn the order down"}
          </button>
          <button
            type="button"
            onClick={() => setMode("choose")}
            className={`${BUTTON} border-rule-strong bg-paper-raised text-ink`}
          >
            Back
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-6">
      <form action={ackAction}>
        {/* The promise date. docs/data-model.md says promise_date is "set once
            acknowledged" and the form never asked — so the happy path left it
            null forever and every on-time-delivery metric had nothing to
            measure against. Defaulted to the need-by so the common case is
            still one tap. */}
        {lines.some((l) => l.needByDate) && (
          <div className="mb-4 border border-rule bg-paper p-3">
            <p className="mb-2 text-sm text-ink-soft">
              {lines.length === 1
                ? "When will it ship?"
                : "When will each line ship? Leave a date alone if you can make it."}
            </p>
            <div className="space-y-2">
              {lines.map((line) => (
                <div key={line.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <label htmlFor={`promise-${line.id}`} className="min-w-32 flex-1 font-mono text-xs">
                    {line.itemNumber}
                  </label>
                  <input
                    id={`promise-${line.id}`}
                    name={`promise-${line.id}`}
                    type="date"
                    defaultValue={line.needByDate?.slice(0, 10)}
                    className="min-h-11 border border-rule-strong bg-paper-raised px-3 py-2 text-sm text-ink"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <Error message={ackState?.error} />

        {/* One full-width button carrying the actual commitment. */}
        <button type="submit" disabled={ackPending} className={`${BUTTON} border-ink bg-ink text-paper`}>
          {ackPending
            ? "Confirming…"
            : single
              ? `Confirm — ${formatQuantity(single.quantity)} ${single.uom}${earliest ? ` by ${formatDate(earliest)}` : ""}`
              : `Confirm all ${lines.length} lines${earliest ? ` from ${formatDate(earliest)}` : ""}`}
        </button>
      </form>

      <div className="mt-2 space-y-2">
        {/* `key` on each trigger so React can't reuse one button's DOM node
            for another with a different `type` — the reuse that turned a
            single click on the quote form's decline trigger into an
            immediate submit. */}
        <button
          key="propose-trigger"
          type="button"
          onClick={() => setMode("propose")}
          className={`${BUTTON} border-rule-strong bg-paper-raised text-ink`}
        >
          I can do it, but not like this
        </button>
        <button
          key="reject-trigger"
          type="button"
          onClick={() => setMode("reject")}
          className="min-h-11 w-full px-4 py-2 text-sm text-ink-soft underline-offset-2 hover:underline"
        >
          I can&apos;t take this order
        </button>
      </div>
    </div>
  );
}

function Error({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-4 border-l-2 border-age-4 bg-paper px-3 py-2 text-sm text-ink">
      {message}
    </p>
  );
}

/**
 * The receipt, written in the third person — because it gets forwarded.
 *
 * "Thanks — recorded" told the supplier nothing they could show anyone. A
 * shop foreman forwards this to their own boss, and the sentence that
 * survives that forward is the one that names who did what, on which order,
 * for when.
 */
function Receipt({
  outcome,
  poNumber,
  tenantName,
  lines,
  token,
}: {
  outcome: "confirmed" | "proposed" | "rejected";
  poNumber: string;
  tenantName: string;
  lines: Line[];
  token: string;
}) {
  const single = lines.length === 1 ? lines[0] : null;
  const earliest = lines
    .map((l) => l.needByDate)
    .filter((d): d is string => d != null)
    .sort()[0];

  return (
    <div className="mt-6 border-t-2 border-ink pt-5">
      <h2 className="text-lg font-semibold text-ink">
        {outcome === "confirmed"
          ? "Confirmed."
          : outcome === "proposed"
            ? "Sent back for approval."
            : "Turned down."}
      </h2>

      <p className="mt-3 text-sm text-ink-soft">
        {outcome === "confirmed" && (
          <>
            Your company confirmed{" "}
            {single ? (
              <>
                <strong className="text-ink">
                  {formatQuantity(single.quantity)} {single.uom} of {single.itemNumber}
                </strong>
                {earliest ? (
                  <>
                    {" "}
                    for delivery <strong className="text-ink">{formatDate(earliest)}</strong>
                  </>
                ) : null}
              </>
            ) : (
              <>
                all <strong className="text-ink">{lines.length} lines</strong> on {poNumber}
              </>
            )}{" "}
            against {tenantName}&apos;s order <strong className="text-ink">{poNumber}</strong>.
          </>
        )}
        {outcome === "proposed" && (
          <>
            Your proposed changes to <strong className="text-ink">{poNumber}</strong> have gone to{" "}
            {tenantName}. Nothing is agreed until they accept — they&apos;ll come back to you.
          </>
        )}
        {outcome === "rejected" && (
          <>
            {tenantName} has been told you can&apos;t take{" "}
            <strong className="text-ink">{poNumber}</strong>. Someone there will pick it up.
          </>
        )}
      </p>

      {outcome === "confirmed" && earliest && (
        <div className="mt-5">
          {/* One route, and it puts the buyer's need-by into a shop foreman's
              calendar — where it will still be, on the day, whether or not
              anyone remembers this screen. */}
          <a
            href={`/a/${token}/calendar.ics`}
            download
            className="inline-flex min-h-11 items-center border border-rule-strong bg-paper-raised px-4 py-2 text-sm font-medium text-ink"
          >
            Add to calendar ({formatDate(earliest)})
          </a>
        </div>
      )}

      <p className="mt-5 text-sm text-ink-faint">
        You can close this page. Reply to the email that brought you here if anything changes.
      </p>
    </div>
  );
}
