"use client";

import { useActionState, useState } from "react";
import { connectIntegration, type FormActionState } from "@/app/actions/integrations";
import { FormErrors, SelectField, SubmitButton, TextField } from "@/components/forms";
import { valueFor } from "@/lib/form-state";

/**
 * The connect form. Every field is labelled, every error lands under the
 * control it's about, and a failure echoes the rest back — the Wave 1 rules,
 * which matter more here than anywhere: this form is filled in once, by
 * someone reading values off two different Epicor screens, and losing it to a
 * mistyped company id is a genuinely infuriating way to meet a product.
 */
export function EpicorConnectForm({ integrationId }: { integrationId: string }) {
  const [state, formAction] = useActionState<FormActionState, FormData>(connectIntegration, undefined);
  const [authMode, setAuthMode] = useState("basic");

  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="integrationId" value={integrationId} />

      <p className="mb-4 max-w-2xl text-sm text-ink-soft">
        Kinetic needs two separate credentials on every call: an API key, and a sign-in. They come
        from different screens and fail differently, so we test them separately and tell you which
        one is wrong.
      </p>

      <FormErrors state={state} />

      <div className="grid gap-x-6 sm:grid-cols-2">
        <TextField
          label="Kinetic server URL"
          name="baseUrl"
          required
          placeholder="https://kinetic.yourcompany.com/Prod"
          hint="The address you use to reach Kinetic. Paste it straight from your browser."
          error={errors.baseUrl}
          defaultValue={valueFor(state, "baseUrl", "")}
        />
        <TextField
          label="Company ID"
          name="company"
          required
          placeholder="EPIC06"
          hint="Epicor's own company code, not your company name."
          error={errors.company}
          defaultValue={valueFor(state, "company", "")}
        />
        <TextField
          label="API key"
          name="apiKey"
          type="password"
          required
          hint="Epicor: Security → API Key Maintenance. Its Access Scope decides which of the four things below actually work."
          error={errors.apiKey}
          defaultValue={valueFor(state, "apiKey", "")}
        />
        <SelectField
          label="Sign-in method"
          name="authMode"
          required
          error={errors.authMode}
          value={authMode}
          onChange={(event) => setAuthMode(event.target.value)}
        >
          <option value="basic">User name and password</option>
          <option value="oauth2">OAuth2 client credentials</option>
        </SelectField>

        {authMode === "basic" ? (
          <>
            <TextField
              label="Service account user name"
              name="username"
              required
              autoComplete="off"
              error={errors.username}
              defaultValue={valueFor(state, "username", "")}
            />
            <TextField
              label="Service account password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              error={errors.password}
              defaultValue={valueFor(state, "password", "")}
            />
          </>
        ) : (
          <>
            <TextField
              label="Client ID"
              name="clientId"
              required
              error={errors.clientId}
              defaultValue={valueFor(state, "clientId", "")}
            />
            <TextField
              label="Client secret"
              name="clientSecret"
              type="password"
              required
              autoComplete="new-password"
              error={errors.clientSecret}
              defaultValue={valueFor(state, "clientSecret", "")}
            />
            <TextField
              label="Token URL"
              name="tokenUrl"
              optional
              hint="Only if your Kinetic doesn't issue its own tokens — e.g. you federate to Entra ID."
              error={errors.tokenUrl}
              defaultValue={valueFor(state, "tokenUrl", "")}
            />
          </>
        )}
      </div>

      <div className="mt-2">
        <SubmitButton variant="primary" pendingLabel="Testing the connection…">
          Connect and test
        </SubmitButton>
      </div>

      <p className="mt-3 max-w-2xl text-xs text-ink-faint">
        Nothing is stored until both credentials answer. The first sync mirrors your orders and
        suppliers into ZenoSource and does not email anyone — you decide when the chase starts.
      </p>
    </form>
  );
}
