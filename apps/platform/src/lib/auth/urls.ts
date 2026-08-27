import "server-only";

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function ssoStartUrl(slug: string): string {
  return `${appBaseUrl()}/api/sso/${encodeURIComponent(slug)}/start`;
}

export function ssoCallbackUrl(slug: string): string {
  return `${appBaseUrl()}/api/sso/${encodeURIComponent(slug)}/callback`;
}

export function ssoMetadataUrl(slug: string): string {
  return `${appBaseUrl()}/api/sso/${encodeURIComponent(slug)}/metadata`;
}

export function serviceProviderRef(slug: string): string {
  return `${appBaseUrl()}/sso/saml/${encodeURIComponent(slug)}`;
}

export function directoryBaseUrl(): string {
  return `${appBaseUrl()}/api/scim/v2`;
}
