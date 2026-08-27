import "server-only";
import { epicorConnector } from "@zenosource/epicor";
import { oktaConnector } from "@zenosource/okta";
import type { ErpConnector } from "./contract";
import type { BaseConnector, IdpConnector } from "./idp-contract";

// Where declarations meet implementations.
//
// These assignments are the conformance check: a connector restates the
// canonical types in its own package, and structural typing is what makes the
// two halves meet. Two maps rather than one union — a union-typed lookup does
// not compile at the call sites using an ERP-only member, and erases the
// structural check these assignments exist to perform.

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

/** For the paths that don't care which kind: connecting, and testing a connection. */
export function getAnyConnector(integrationId: string): BaseConnector | undefined {
  return ERP_CONNECTORS[integrationId] ?? IDP_CONNECTORS[integrationId];
}

/**
 * Whether this build can do anything with an integration id. registry.test.ts
 * asserts it agrees with the registry's `available`/`planned` status, so a card
 * cannot offer a connect button that fails on click.
 */
export function isImplemented(integrationId: string): boolean {
  return integrationId in ERP_CONNECTORS || integrationId in IDP_CONNECTORS;
}
