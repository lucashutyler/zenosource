"use client";

import { useActionState } from "react";
import { changeOwnPassword } from "@/app/actions/team";
import { FormErrors, SubmitButton, TextField } from "@/components/forms";

export function ChangeOwnPasswordForm() {
  const [state, action] = useActionState(changeOwnPassword, undefined);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="max-w-xl">
      <FormErrors state={state} />
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField
          label="Current password"
          name="current"
          type="password"
          required
          autoComplete="current-password"
          error={errors.current}
        />
        <TextField
          label="New password"
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          hint="At least 12 characters."
          error={errors.password}
        />
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton variant="secondary" pendingLabel="Changing…">
          Change it
        </SubmitButton>
        {state?.ok && (
          <span role="status" className="text-sm text-settled">
            {state.ok}
          </span>
        )}
      </div>
    </form>
  );
}
