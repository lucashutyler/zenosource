"use client";

import { useActionState, useState } from "react";
import { acknowledgePOByToken, rejectPOByToken } from "@/app/actions/purchase-orders";
import { ErrorText, SubmitButton, Input, Field } from "@/components/ui";

type ResponseState = { error?: string } | undefined;

export function PoResponseForm({ token }: { token: string }) {
  const [resolved, setResolved] = useState(false);
  const [showReject, setShowReject] = useState(false);

  const acknowledge = async (_prev: ResponseState): Promise<ResponseState> => {
    const result = await acknowledgePOByToken(token);
    if (!result.error) setResolved(true);
    return result;
  };
  const reject = async (_prev: ResponseState, formData: FormData): Promise<ResponseState> => {
    const result = await rejectPOByToken(token, formData);
    if (!result.error) setResolved(true);
    return result;
  };

  const [ackState, ackAction, ackPending] = useActionState(acknowledge, undefined);
  const [rejState, rejAction, rejPending] = useActionState(reject, undefined);

  if (resolved) {
    return (
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Thanks — recorded. You can close this page.
      </p>
    );
  }

  return (
    <div>
      {!showReject ? (
        <div className="flex gap-3">
          <form action={ackAction}>
            <SubmitButton pending={ackPending}>
              {ackPending ? "Acknowledging..." : "Acknowledge"}
            </SubmitButton>
          </form>
          <button
            type="button"
            onClick={() => setShowReject(true)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
          >
            Reject
          </button>
        </div>
      ) : (
        <form action={rejAction}>
          <Field label="Reason (optional)" name="reason">
            <Input name="reason" />
          </Field>
          <div className="flex gap-3">
            <SubmitButton pending={rejPending} variant="danger">
              {rejPending ? "Rejecting..." : "Confirm reject"}
            </SubmitButton>
            <button
              type="button"
              onClick={() => setShowReject(false)}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
            >
              Back
            </button>
          </div>
        </form>
      )}
      <ErrorText>{ackState?.error ?? rejState?.error}</ErrorText>
    </div>
  );
}
