"use client";

import { useActionState } from "react";
import { createTeamMember } from "@/app/actions/team";
import { FormErrors, SelectField, SubmitButton, TextField } from "@/components/forms";
import { valueFor } from "@/lib/form-state";

export function AddTeamMemberForm() {
  const [state, action] = useActionState(createTeamMember, undefined);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action}>
      <FormErrors state={state} />
      <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Name"
          name="name"
          required
          defaultValue={valueFor(state, "name", "")}
          error={errors.name}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          required
          autoComplete="off"
          defaultValue={valueFor(state, "email", "")}
          error={errors.email}
        />
        <SelectField
          label="Role"
          name="role"
          required
          defaultValue={valueFor(state, "role", "MEMBER")}
          error={errors.role}
        >
          <option value="MEMBER">Member — assigned locations only</option>
          <option value="OWNER">Owner — everything</option>
        </SelectField>
        <TextField
          label="Password"
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          hint="At least 12 characters. You'll need to tell them — there's no invite email yet."
          error={errors.password}
        />
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Adding…">Add them</SubmitButton>
        {state?.ok && (
          <span role="status" className="text-sm text-settled">
            {state.ok}
          </span>
        )}
      </div>
    </form>
  );
}
