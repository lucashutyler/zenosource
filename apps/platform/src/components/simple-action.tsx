"use client";

import { SubmitButton, ConfirmSubmit } from "@/components/forms";
import type { ButtonVariant } from "@/components/ui";

/**
 * A server action behind a button, with a pending state you cannot forget and
 * an optional confirm for the ones that can't be undone.
 *
 * Every bare `<form action={x}><button>` in the app was one of these written
 * out longhand, and every one of them was missing its pending state — the
 * seven that mattered most, precisely because they were written last.
 */
export function SimpleAction({
  action,
  label,
  variant = "secondary",
  pendingLabel,
  confirm,
}: {
  action: () => void | Promise<void>;
  label: string;
  variant?: ButtonVariant;
  pendingLabel?: string;
  confirm?: { title: string; body: React.ReactNode; confirmLabel: string };
}) {
  return (
    <form action={action}>
      {confirm ? (
        <ConfirmSubmit
          trigger={label}
          variant={variant}
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
        />
      ) : (
        <SubmitButton variant={variant} pendingLabel={pendingLabel}>
          {label}
        </SubmitButton>
      )}
    </form>
  );
}
