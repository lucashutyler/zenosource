"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/auth";
import { SubmitButton, TextField } from "@/components/forms";
import { ErrorText } from "@/components/ui";

export default function LoginPage() {
  const [state, action] = useActionState(login, undefined);

  return (
    <div className="flex flex-1 items-center justify-center bg-paper px-4 py-12">
      <form action={action} className="w-full max-w-sm border border-rule bg-paper-raised p-8">
        <div className="mb-6 border-b-2 border-ink pb-4">
          <span className="mb-2 flex h-8 w-8 items-center justify-center border border-ink font-mono text-sm font-bold text-ink">
            Z
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-ink">ZenoSource</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Procurement that chases itself.
          </p>
        </div>

        <ErrorText>{state?.error}</ErrorText>

        <TextField label="Email" name="email" type="email" required autoComplete="email" />
        <TextField
          label="Password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />

        <SubmitButton className="w-full" pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>
    </div>
  );
}
