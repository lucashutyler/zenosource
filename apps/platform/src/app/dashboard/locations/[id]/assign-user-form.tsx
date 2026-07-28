"use client";

import { useActionState } from "react";
import { assignUserToLocation } from "@/app/actions/locations";
import { Field, Select, ErrorText, SubmitButton } from "@/components/ui";

export function AssignUserForm({
  locationId,
  candidates,
}: {
  locationId: string;
  candidates: { id: string; name: string; email: string }[];
}) {
  const boundAction = assignUserToLocation.bind(null, locationId);
  const [state, action, pending] = useActionState(boundAction, undefined);

  if (candidates.length === 0) {
    return (
      <p className="border-t border-zinc-200 p-4 text-xs text-zinc-500 dark:border-zinc-800">
        Every internal user is already assigned to this location.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-3 border-t border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex-1">
        <Field label="Assign a user" name="internalUserId">
          <Select name="internalUserId" required defaultValue="">
            <option value="" disabled>
              Choose a user
            </option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mb-4">
        <SubmitButton pending={pending} variant="secondary">
          {pending ? "Assigning..." : "Assign"}
        </SubmitButton>
      </div>
      <div className="basis-full">
        <ErrorText>{state?.error}</ErrorText>
      </div>
    </form>
  );
}
