"use client";

import { useActionState } from "react";
import { sendRFQ } from "@/app/actions/rfqs";
import { ConfirmSubmit } from "@/components/forms";
import { ErrorText } from "@/components/ui";
import { plural } from "@/lib/format";

/**
 * `Send to 3 suppliers`, not `Save RFQ`.
 *
 * The old label was a lie of omission: the button emailed three companies and
 * opened three external action items. A button whose name doesn't describe
 * what it does is the most expensive kind of copy error, because people learn
 * to click it without reading.
 */
export function SendRFQForm({ rfqId, inviteCount }: { rfqId: string; inviteCount: number }) {
  const [state, action] = useActionState(sendRFQ.bind(null, rfqId), undefined);

  if (inviteCount === 0) return null;

  return (
    <form action={action}>
      <ConfirmSubmit
        trigger={`Send to ${inviteCount} ${plural(inviteCount, "supplier")}`}
        variant="primary"
        confirmVariant="primary"
        title={`Send this to ${inviteCount} ${plural(inviteCount, "supplier")}?`}
        body={`Each one gets an email with a one-tap link to price the lines — no account, no password — and starts being chased daily until they answer or decline.`}
        confirmLabel="Send it"
      />
      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && (
        <p role="status" className="mt-2 text-sm text-settled">
          {state.ok}
        </p>
      )}
    </form>
  );
}
