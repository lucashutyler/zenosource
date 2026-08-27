import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

// searchParams is read here because doing it in the Client Component below
// needs either `use()`, which suspends, or a Suspense boundary.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sso?: string; reason?: string }>;
}) {
  const { sso, reason } = await searchParams;

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
