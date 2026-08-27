import "server-only";

// Every address derives from APP_BASE_URL and the tenant's own slug — never
// from a request header, and never from the document being validated, which
// must not nominate the audience or callback it is checked against.

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** Where a sign-in starts. What an identity provider's app tile points at. */
export function ssoStartUrl(slug: string): string {
  return `${appBaseUrl()}/api/sso/${encodeURIComponent(slug)}/start`;
}

/** Where the credential comes back — the string a customer configures at their end. */
export function ssoCallbackUrl(slug: string): string {
  return `${appBaseUrl()}/api/sso/${encodeURIComponent(slug)}/callback`;
}

/** The document a customer imports at their end. */
export function ssoMetadataUrl(slug: string): string {
  return `${appBaseUrl()}/api/sso/${encodeURIComponent(slug)}/metadata`;
}

/**
 * Who we are, as this tenant's identity provider knows us. Per-tenant rather
 * than one identifier for the product: two customers can federate from the same
 * identity provider, and this is what makes an assertion minted for one of them
 * unusable at the other.
 */
export function serviceProviderRef(slug: string): string {
  return `${appBaseUrl()}/sso/saml/${encodeURIComponent(slug)}`;
}

/** Where a directory sends its provisioning calls. */
export function directoryBaseUrl(): string {
  return `${appBaseUrl()}/api/scim/v2`;
}
