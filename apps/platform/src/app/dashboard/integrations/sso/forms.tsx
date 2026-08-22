"use client";

import { useActionState } from "react";
import {
  addDomain,
  issueToken,
  saveGroupMapping,
  type DirectoryActionState,
} from "@/app/actions/directory";
import { FormErrors, SelectField, SubmitButton, TextField } from "@/components/forms";
import { Callout } from "@/components/ui";
import { valueFor } from "@/lib/form-state";

export function AddDomainForm() {
  const [state, action] = useActionState<DirectoryActionState, FormData>(addDomain, undefined);
  return (
    <form action={action} noValidate className="max-w-md">
      <FormErrors state={state} />
      {state?.ok && (
        <div className="mb-3">
          <Callout title="Added">{state.ok}</Callout>
        </div>
      )}
      <TextField
        label="Email domain"
        name="domain"
        required
        placeholder="yourcompany.com"
        hint="Anyone with an address here is sent to your identity provider when they use the organization sign-in."
        error={state?.fieldErrors?.domain}
        defaultValue={valueFor(state, "domain", "")}
      />
      <SubmitButton pendingLabel="Adding…">Add domain</SubmitButton>
    </form>
  );
}

export function IssueTokenForm() {
  const [state, action] = useActionState<DirectoryActionState, FormData>(issueToken, undefined);
  return (
    <form action={action} noValidate className="max-w-md">
      <FormErrors state={state} />
      {state?.issuedToken && (
        <div className="mb-3">
          <Callout title="Copy this now">
            <span className="mb-2 block">
              It won&apos;t be shown again — nothing here can give it back, so if you lose it,
              issue another and revoke this one.
            </span>
            <code className="block w-full break-all border border-rule bg-paper p-2 font-mono text-xs text-ink">
              {state.issuedToken}
            </code>
          </Callout>
        </div>
      )}
      <TextField
        label="What is it for"
        name="name"
        required
        placeholder="Okta provisioning"
        hint="So you know which one to revoke later."
        error={state?.fieldErrors?.name}
        defaultValue={valueFor(state, "name", "")}
      />
      <SubmitButton pendingLabel="Creating…">Create token</SubmitButton>
    </form>
  );
}

export function GroupMappingForm({
  group,
  locations,
}: {
  group: { id: string; displayName: string; mappedRole: string | null; locationIds: string[] };
  locations: { id: string; name: string; code: string }[];
}) {
  const [state, action] = useActionState<DirectoryActionState, FormData>(
    saveGroupMapping,
    undefined
  );

  return (
    <form action={action} noValidate>
      <input type="hidden" name="groupId" value={group.id} />
      <FormErrors state={state} />
      {state?.ok && <p className="mb-2 text-sm text-ink-soft">{state.ok}</p>}

      <div className="grid gap-x-6 sm:grid-cols-2">
        <SelectField
          label="Being in this group makes someone"
          name="mappedRole"
          defaultValue={group.mappedRole ?? ""}
        >
          <option value="">Nothing — this group grants no access</option>
          <option value="MEMBER">A member</option>
        </SelectField>

        <fieldset className="mb-4">
          <legend className="mb-1.5 block text-sm font-medium text-ink">
            And gives them these locations
          </legend>
          {locations.length === 0 ? (
            <p className="text-sm text-ink-faint">
              You have no locations yet, so there is nothing to grant.
            </p>
          ) : (
            <div className="space-y-1">
              {locations.map((location) => (
                <label key={location.id} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="locationIds"
                    value={location.id}
                    defaultChecked={group.locationIds.includes(location.id)}
                    className="border-rule"
                  />
                  <span>
                    {location.name}{" "}
                    <span className="font-mono text-xs text-ink-faint">{location.code}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </div>

      <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
    </form>
  );
}
