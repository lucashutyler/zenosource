import "server-only";
import { epicorConnector } from "@zenosource/epicor";
import { oktaConnector } from "@zenosource/okta";
import type { ErpConnector } from "./contract";
import type { BaseConnector, IdpConnector } from "./idp-contract";

// Where declarations meet implementations.
//
// These assignments are the conformance check. Each connector is written in a
// package that imports nothing from here — each has its own restatement of the
// canonical types (`integrations/*/src/types.ts`) precisely so it can stay
// dependency-light and independently deployable. TypeScript's structural
// typing is what makes the two halves meet, and these lines are where they do:
// if a connector's shape drifts from its contract in either direction, the
// build fails here rather than the sync, or the sign-in, failing at a customer.
//
// Two maps rather than one union. `getIntegration(id).type` was always the
// authoritative answer to "what kind is this", and a union-typed lookup would
// not compile at the call sites that use an ERP-only member — while erasing
// exactly the structural check these assignments exist to perform.
//
// A connector is registered here and nowhere else, so "which integrations are
// actually implemented" has one answer.

const ERP_CONNECTORS: Record<string, ErpConnector> = {
  epicor: epicorConnector,
};

const IDP_CONNECTORS: Record<string, IdpConnector> = {
  okta: oktaConnector,
};

export function getErpConnector(integrationId: string): ErpConnector | undefined {
  return ERP_CONNECTORS[integrationId];
}

export function hasErpConnector(integrationId: string): boolean {
  return integrationId in ERP_CONNECTORS;
}

export function getIdpConnector(integrationId: string): IdpConnector | undefined {
  return IDP_CONNECTORS[integrationId];
}

export function hasIdpConnector(integrationId: string): boolean {
  return integrationId in IDP_CONNECTORS;
}

/**
 * The two things every connect form and health check needs, whichever kind it
 * turns out to be. Used by the paths that genuinely do not care —
 * `connectIntegration` and the "Test connection" button — so that adding a
 * third kind of integration does not mean a third branch in each of them.
 */
export function getAnyConnector(integrationId: string): BaseConnector | undefined {
  return ERP_CONNECTORS[integrationId] ?? IDP_CONNECTORS[integrationId];
}

/**
 * Whether this build can actually do anything with an integration id. The
 * integrations page offers a connect form on the strength of this, and
 * registry.test.ts asserts it agrees with the registry's own `available` /
 * `planned` status — a card that offers a button which fails on click is the
 * failure that assertion exists to prevent.
 */
export function isImplemented(integrationId: string): boolean {
  return integrationId in ERP_CONNECTORS || integrationId in IDP_CONNECTORS;
}
