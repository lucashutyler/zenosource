export { OktaConnector, oktaConnector, OKTA_CAPABILITIES } from "./connector";
export { parseConfig, readSession, type OktaConfig, type OktaSecrets } from "./config";
export { parseIdpMetadata, normalizeCertificate, type IdpMetadata } from "./metadata";
export { CERTIFICATE_WARNING_DAYS } from "./health";

// The scripted identity provider is deliberately not exported here: reaching
// a credential-minting fake requires importing `@zenosource/okta/testing`.

export * from "./types";
