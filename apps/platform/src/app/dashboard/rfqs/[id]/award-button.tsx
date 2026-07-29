"use client";

import { useActionState } from "react";
import { awardRFQQuote } from "@/app/actions/rfqs";
import { ConfirmSubmit } from "@/components/forms";
import { ErrorText } from "@/components/ui";
import { formatMoney } from "@/lib/format";

/**
 * Awarding is irreversible, closes out every other invited supplier, and —
 * critically — creates no purchase order. It was a plain grey button that
 * fired on one click with no confirmation and no pending state.
 *
 * The confirm states the consequence *including what doesn't happen*, because
 * "I awarded it and nothing arrived" is the failure this design invites and
 * the sentence that prevents it costs nothing.
 */
export function AwardButton({
  rfqId,
  quoteId,
  supplierName,
  total,
  complete,
  coveredCount,
  lineCount,
  otherSuppliers,
}: {
  rfqId: string;
  quoteId: string;
  supplierName: string;
  total: number;
  complete: boolean;
  coveredCount: number;
  lineCount: number;
  otherSuppliers: string[];
}) {
  const [state, action] = useActionState(awardRFQQuote.bind(null, rfqId, quoteId), undefined);

  return (
    <form action={action}>
      <ConfirmSubmit
        trigger={`Award to ${supplierName}`}
        variant="secondary"
        confirmVariant="primary"
        title={`Award this to ${supplierName}?`}
        body={
          <>
            {!complete && (
              <p className="mb-2 border-l-2 border-age-3 pl-2 text-ink">
                {supplierName} only priced {coveredCount} of {lineCount} lines. The{" "}
                {lineCount - coveredCount} they skipped stay unsourced — you&apos;ll need another
                supplier for those.
              </p>
            )}
            <p>
              Their quoted total is{" "}
              <strong className="text-ink">{formatMoney(total)}</strong>
              {complete ? " across every line" : " for the lines they bid"}.
            </p>
            <p className="mt-2">
              This closes the request for{" "}
              {otherSuppliers.length > 0 ? otherSuppliers.join(" and ") : "everyone else"}. It does{" "}
              <strong className="text-ink">not</strong> create a purchase order — you&apos;ll raise
              that next, and it lands on your board until you do.
            </p>
          </>
        }
        confirmLabel="Award it"
      />
      <ErrorText>{state?.error}</ErrorText>
    </form>
  );
}
