import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signInConnectionFor } from "@/lib/auth/broker";
import { resolveTenantByEmailDomain } from "@/lib/auth/tenant-resolution";
import { ssoStartUrl } from "@/lib/auth/urls";
import { SubmitButton, TextField } from "@/components/forms";
import { ErrorText } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in with your organization" };

// A Server Component with a plain GET form, and no server action.
//
// That is a correctness requirement, not a style choice. A server action's
// redirect() is performed by the router as a client-side navigation, and the
// router cannot follow a redirect to another origin — which is exactly what
// the next hop is. The symptom is a browser that sits on /api/sso/{slug}/start
// having gone nowhere, and it took a real E2E failure to see it.
//
// A native form submit is a document navigation, so every hop after it —
// here, then the start route, then the identity provider, then back — is a
// real HTTP redirect the browser follows. Signing in therefore needs no
// JavaScript at all, which is a good property for an auth flow to have anyway.

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

        {/* Deliberately the same sentence for an address we don't know, an
            organization that hasn't connected anything, and something that
            isn't an address. Saying which would turn this box into an oracle
            for whether a company uses ZenoSource and whether they federate —
            useful to somebody writing a phishing email and to nobody else. */}
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
