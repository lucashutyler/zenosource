export { OktaConnector, oktaConnector, OKTA_CAPABILITIES } from "./connector";
export { parseConfig, readSession, type OktaConfig, type OktaSecrets } from "./config";
export { parseIdpMetadata, normalizeCertificate, type IdpMetadata } from "./metadata";
export { CERTIFICATE_WARNING_DAYS } from "./health";

// The credential-minting fake is reachable only through `@zenosource/okta/testing`.

export * from "./types";
