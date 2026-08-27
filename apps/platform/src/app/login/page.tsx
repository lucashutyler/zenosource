import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

// The form is a Client Component (useActionState keeps what was typed after a
// failed attempt), and reading searchParams there needs either `use()`, which
// suspends, or useSearchParams, which needs a Suspense boundary — so it is
// read here and passed down as a string.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sso?: string; reason?: string }>;
}) {
  const { sso, reason } = await searchParams;

  // Password sign-in is untouched by whatever went wrong with the federated
  // one, so this is a message above a working form, not an outage screen.
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
