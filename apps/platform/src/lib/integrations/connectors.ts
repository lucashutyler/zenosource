import "server-only";
import { epicorConnector } from "@zenosource/epicor";
import type { ErpConnector } from "./contract";

// Where declarations meet implementations.
//
// This assignment is the conformance check. `epicorConnector` is written in a
// package that imports nothing from here — it has its own restatement of the
// canonical types (integrations/erp/epicor/src/types.ts) precisely so it can
// stay dependency-free and independently deployable. TypeScript's structural
// typing is what makes the two halves meet, and this line is where they do:
// if the connector's shape drifts from the contract in either direction, the
// build fails here rather than the sync failing at a customer.
//
// A connector is registered here and nowhere else. Everything that runs a
// sync, checks health, or pushes a write-back goes through getConnector(), so
// "which integrations are actually implemented" has one answer.
const CONNECTORS: Record<string, ErpConnector> = {
  epicor: epicorConnector,
};

export function getConnector(integrationId: string): ErpConnector | undefined {
  return CONNECTORS[integrationId];
}

export function hasConnector(integrationId: string): boolean {
  return integrationId in CONNECTORS;
}
