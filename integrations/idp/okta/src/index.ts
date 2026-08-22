// Okta identity-provider connector for ZenoSource.
//
// The platform imports `oktaConnector` and nothing else on the running path —
// everything below it (OpenID discovery, JWKS, SAML signatures, the directory
// protocol's schema URNs) stays inside this package by design. See README.md,
// and docs/integrations.md#okta-idp for the surface it targets.

export { OktaConnector, oktaConnector, OKTA_CAPABILITIES } from "./connector";
export { parseConfig, readSession, type OktaConfig, type OktaSecrets } from "./config";
export { parseIdpMetadata, normalizeCertificate, type IdpMetadata } from "./metadata";
export { CERTIFICATE_WARNING_DAYS } from "./health";

// The scripted identity provider is deliberately NOT exported here. It lives
// behind a second entry point, `@zenosource/okta/testing`, so that reaching a
// credential-minting fake requires importing a path whose name says what it
// is. Epicor's fake isn't exported at all, because nothing outside that
// package needs one; this one is needed by the E2E runner and by
// `npm run fake-idp`, both of which are outside the shipped app. The split
// entry is what keeps it out of the product — a boundary rather than a flag
// somebody can forget to set.

export * from "./types";
