import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signInConnectionFor } from "@/lib/auth/broker";
import { resolveTenantByEmailDomain } from "@/lib/auth/tenant-resolution";
import { ssoStartUrl } from "@/lib/auth/urls";
import { SubmitButton, TextField } from "@/components/forms";
import { ErrorText } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in with your organization" };

// A plain GET form, not a server action: a server action's redirect() is a
// client-side router navigation, and the router cannot follow the hop to
// another origin that the next leg requires.

export default async function SsoLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  const submitted = (email ?? "").trim().toLowerCase();

  if (submitted) {
    const tenant = await resolveTenantByEmailDomain(submitted);
    const connection = tenant ? await signInConnectionFor(tenant.id) : null;
    if (tenant && connection) {
      redirect(`${ssoStartUrl(tenant.slug)}?hint=${encodeURIComponent(submitted)}`);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-paper px-4 py-12">
      <form method="GET" className="w-full max-w-sm border border-rule bg-paper-raised p-8">
        <div className="mb-6 border-b-2 border-ink pb-4">
          <span className="mb-2 flex h-8 w-8 items-center justify-center border border-ink font-mono text-sm font-bold text-ink">
            Z
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Sign in with your organization
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            We&apos;ll send you to your company&apos;s own sign-in page.
          </p>
        </div>

        {/* Deliberately the same sentence for every failure: saying which would
            make this box an oracle for whether a company federates. */}
        <ErrorText>
          {submitted
            ? "We don't have single sign-on set up for that address. Sign in with your password instead."
            : undefined}
        </ErrorText>

        <TextField
          label="Work email"
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={submitted}
          hint="We only use the domain to find your organization."
        />

        <SubmitButton className="w-full" pendingLabel="Finding your organization…">
          Continue
        </SubmitButton>

        <p className="mt-4 border-t border-rule pt-4 text-xs text-ink-faint">
          <Link href="/login" className="underline underline-offset-2 hover:text-ink">
            Sign in with a password instead
          </Link>
        </p>
      </form>
    </div>
  );
}
