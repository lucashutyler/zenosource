"use client";

import { useActionState } from "react";
import { closeRFQ } from "@/app/actions/rfqs";
import { ConfirmSubmit, TextAreaField } from "@/components/forms";
import { ErrorText } from "@/components/ui";

export function CloseRFQForm({
  rfqId,
  number,
  awarded,
}: {
  rfqId: string;
  number: string;
  awarded: boolean;
}) {
  const [state, action] = useActionState(closeRFQ.bind(null, rfqId), undefined);

  return (
    <form action={action}>
      <ConfirmSubmit
        trigger={awarded ? "Close it out" : "Close without awarding"}
        variant="quiet"
        confirmVariant="primary"
        title={`Close ${number}?`}
        body={
          awarded
            ? "The award is recorded and the PO has been raised (or won't be). Closing settles the request — nothing further is chased on either side."
            : "Nobody wins this one. Every invited supplier stops being chased for a quote, and any quotes already in stay on the record but can no longer be awarded."
        }
        confirmLabel="Close it"
      >
        <TextAreaField
          label="Why"
          name="reason"
          optional
          rows={2}
          hint="Recorded on the request. Not sent to the suppliers."
        />
      </ConfirmSubmit>
      <ErrorText>{state?.error}</ErrorText>
    </form>
  );
}
