import "server-only";
import { epicorConnector } from "@zenosource/epicor";
import { oktaConnector } from "@zenosource/okta";
import type { ErpConnector } from "./contract";
import type { BaseConnector, IdpConnector } from "./idp-contract";

// These assignments are the conformance check: a connector package imports
// nothing from here and restates the canonical types itself, so structural
// typing is what makes the two halves meet.
//
// Two maps rather than one union: a union-typed lookup would not compile at the
// call sites that use an ERP-only member, and would erase that check.

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

/** The shape shared by every kind, for the paths that don't care which it is. */
export function getAnyConnector(integrationId: string): BaseConnector | undefined {
  return ERP_CONNECTORS[integrationId] ?? IDP_CONNECTORS[integrationId];
}

/** Whether this build can actually do anything with an integration id. */
export function isImplemented(integrationId: string): boolean {
  return integrationId in ERP_CONNECTORS || integrationId in IDP_CONNECTORS;
}
