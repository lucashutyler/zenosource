"use client";

import { useActionState } from "react";
import { issuePurchaseOrder } from "@/app/actions/purchase-orders";
import { ConfirmSubmit } from "@/components/forms";
import { ErrorText } from "@/components/ui";

/**
 * Issuing is the moment an internal draft becomes a commitment somebody
 * outside the company acts on. It gets a confirm that names the recipient —
 * "Save" and "Issue" looked identical before, and one of them emails a
 * stranger.
 *
 * The recipient is chosen, not assumed. `contacts[0]` was previously
 * hard-coded, so a supplier with an accounts address first and a scheduler
 * second had every order routed to accounts.
 */
export function IssueForm({
  poId,
  contacts,
  supplierName,
}: {
  poId: string;
  contacts: { id: string; name: string; email: string }[];
  supplierName: string;
}) {
  const [state, action] = useActionState(issuePurchaseOrder.bind(null, poId), undefined);

  return (
    <form action={action}>
      <ConfirmSubmit
        trigger="Issue to supplier"
        variant="primary"
        confirmVariant="primary"
        title={`Send this order to ${supplierName}?`}
        body={
          <>
            They get an email with a one-tap link to confirm — no account, no password — and this
            order starts being chased daily until they answer. Issued orders can&apos;t be edited
            afterwards; changes go through the propose-and-agree flow instead.
          </>
        }
        confirmLabel="Issue it"
      >
        {contacts.length > 1 && (
          <div>
            <label htmlFor="contactId" className="mb-1 block text-sm font-medium text-ink">
              Send to
            </label>
            <select
              id="contactId"
              name="contactId"
              defaultValue={contacts[0]?.id}
              className="min-h-11 w-full border border-rule-strong bg-paper-raised px-3 py-2 text-sm text-ink"
            >
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name} — {contact.email}
                </option>
              ))}
            </select>
          </div>
        )}
        {contacts.length === 1 && (
          <p className="text-sm text-ink-soft">
            Going to <span className="text-ink">{contacts[0].name}</span> at {contacts[0].email}.
          </p>
        )}
      </ConfirmSubmit>
      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && (
        <p role="status" className="mt-2 text-sm text-settled">
          {state.ok}
        </p>
      )}
    </form>
  );
}
