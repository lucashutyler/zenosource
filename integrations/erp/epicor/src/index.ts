// Epicor Kinetic connector for ZenoSource.
//
// The platform imports `epicorConnector` and nothing else — everything below
// it (Kinetic's REST surface, BO names, OData paging, Updatable BAQs) stays
// inside this package by design. See README.md, and
// docs/integrations.md#epicor-erp for the API surface it targets.

export { EpicorConnector, epicorConnector, EPICOR_CAPABILITIES } from "./connector";
export { EpicorClient, changedSinceFilter, type FetchLike, type ClientOptions } from "./client";
export { EpicorError, classifyHttpFailure, isTransportFailure } from "./errors";
export { parseConfig, readSession, type EpicorConfig, type EpicorSecrets } from "./config";
export { DEFAULT_ENDPOINTS, CAPABILITY_PROBES, endpointFor } from "./bo/endpoints";
export { DEFAULT_BAQS, baqIdsFor } from "./baq";
export * from "./types";
