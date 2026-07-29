"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { setSupplierContactStatus, updateSupplierContact } from "@/app/actions/suppliers";
import { SubmitButton, TextField } from "@/components/forms";
import { SimpleAction } from "@/components/simple-action";
import { StatusChip } from "@/components/ui";

type Contact = { id: string; name: string; email: string; status: string };

export function ContactRow({ contact }: { contact: Contact }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(updateSupplierContact.bind(null, contact.id), undefined);
  const errors = state?.fieldErrors ?? {};

  if (editing) {
    return (
      <form
        action={action}
        onSubmit={() => setEditing(false)}
        className="flex flex-wrap items-start gap-3 px-4 py-3"
      >
        <div className="min-w-40 flex-1">
          <TextField
            label="Name"
            name="name"
            required
            defaultValue={contact.name}
            error={errors.name}
            className="mb-0"
          />
        </div>
        <div className="min-w-52 flex-1">
          <TextField
            label="Email"
            name="email"
            type="email"
            required
            defaultValue={contact.email}
            error={errors.email}
            className="mb-0"
          />
        </div>
        <div className="flex gap-2 pt-6">
          <SubmitButton variant="secondary" pendingLabel="Saving…">
            Save
          </SubmitButton>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="min-h-11 px-3 py-2 text-sm text-ink-soft hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  const active = contact.status === "ACTIVE";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <div className="min-w-0">
        <span className={active ? "text-ink" : "text-ink-faint"}>{contact.name}</span>
        <span className="ml-3 text-ink-soft">{contact.email}</span>
        {!active && (
          <span className="ml-3">
            <StatusChip variant="settled">Not chased</StatusChip>
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${contact.name}`}
          className="flex h-11 w-11 items-center justify-center text-ink-faint hover:text-ink"
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </button>
        <SimpleAction
          action={setSupplierContactStatus.bind(null, contact.id, !active)}
          label={active ? "Stop chasing" : "Chase again"}
          variant="quiet"
          confirm={
            active
              ? {
                  title: `Stop chasing ${contact.name}?`,
                  body: "They stop receiving reminders and won't be offered as a recipient. Anything currently open and assigned to them moves to another active contact at this supplier, so nothing falls silent.",
                  confirmLabel: "Stop chasing them",
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
