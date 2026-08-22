import "server-only";

// The addresses a customer's identity-provider admin configures, and the
// identity they know us by. All of them derive from APP_BASE_URL and the
// tenant's own slug — never from a request header, and never from anything in
// the document being validated.
//
// That last point is why this is a file rather than strings built where they
// are used. docs/integrations.md requires the tenant to be resolved *before*
// an assertion or token is validated, and the security content of that
// ordering is that an untrusted document must never nominate the audience,
// the callback, or the certificate it is checked against. Computing them here
// from the route's own path segment makes that structural rather than a rule
// somebody has to remember.

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** Where a sign-in starts. What an identity provider's app tile points at. */
export function ssoStartUrl(slug: string): string {
  return `${appBaseUrl()}/api/sso/${encodeURIComponent(slug)}/start`;
}

/**
 * Where the credential comes back. One URL per tenant, on one protocol-neutral
 * route — a customer configures exactly this string at their end.
 */
export function ssoCallbackUrl(slug: string): string {
  return `${appBaseUrl()}/api/sso/${encodeURIComponent(slug)}/callback`;
}

/** The document a customer imports at their end. */
export function ssoMetadataUrl(slug: string): string {
  return `${appBaseUrl()}/api/sso/${encodeURIComponent(slug)}/metadata`;
}

/**
 * Who we are, as this tenant's identity provider knows us.
 *
 * Per-tenant rather than one identifier for the whole product, and that is a
 * real multi-tenancy control rather than tidiness: two customers can federate
 * from the same identity provider, and a per-tenant audience is what makes an
 * assertion minted for one of them unusable at the other. The cost is one more
 * tenant-specific string in onboarding, which the Okta package's README says
 * out loud.
 */
export function serviceProviderRef(slug: string): string {
  return `${appBaseUrl()}/sso/saml/${encodeURIComponent(slug)}`;
}

/** Where a directory sends its provisioning calls. */
export function directoryBaseUrl(): string {
  return `${appBaseUrl()}/api/scim/v2`;
}
