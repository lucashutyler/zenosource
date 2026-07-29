"use client";

import { useActionState } from "react";
import { assignUserToLocation } from "@/app/actions/locations";
import { SelectField, SubmitButton } from "@/components/forms";

export function AssignUserForm({
  locationId,
  candidates,
}: {
  locationId: string;
  candidates: { id: string; name: string; email: string }[];
}) {
  const [state, action] = useActionState(assignUserToLocation.bind(null, locationId), undefined);
  const errors = state?.fieldErrors ?? {};

  if (candidates.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-ink-faint">
        Everyone on the team already has access to this site.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-start gap-3 bg-paper px-4 py-3">
      <div className="min-w-56 flex-1">
        <SelectField
          label="Give someone access"
          name="internalUserId"
          required
          defaultValue=""
          error={errors.internalUserId}
          className="mb-0"
        >
          <option value="">Choose a person…</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} ({candidate.email})
            </option>
          ))}
        </SelectField>
      </div>
      <div className="pt-6">
        <SubmitButton variant="secondary" pendingLabel="Assigning…">
          Assign
        </SubmitButton>
      </div>
      {state?.error && (
        <p role="alert" className="basis-full text-xs font-medium text-age-4">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="basis-full text-xs text-settled">
          {state.ok}
        </p>
      )}
    </form>
  );
}
