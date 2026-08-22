import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

// A Server Component shell around the form.
//
// The form itself has to be a Client Component — it uses useActionState to
// keep what somebody typed after a failed attempt. But reading searchParams
// from inside a Client Component means either `use()`, which suspends without
// a boundary, or useSearchParams, which needs one — on the single screen every
// other spec in the suite depends on. Reading it here and passing a string
// down costs one file and removes the question.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sso?: string; reason?: string }>;
}) {
  const { sso, reason } = await searchParams;

  // A federated sign-in that didn't complete lands back here rather than on a
  // dead end. Password sign-in is untouched by whatever went wrong, so this is
  // a message above a form that still works — not an outage screen.
  const ssoMessage =
    sso === "failed"
      ? (reason ?? "That sign-in didn't complete. Try again, or use your password.")
      : sso === "unavailable"
        ? "Single sign-on isn't set up for that organization yet."
        : sso === "unknown"
          ? "That sign-in address doesn't belong to an organization here."
          : null;

  return <LoginForm ssoMessage={ssoMessage} />;
}
