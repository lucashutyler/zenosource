// Code, not rows: every tenant sees the same list, and only connection state
// is per-tenant.

import type { Capability } from "./capabilities";

export type IntegrationType = "erp" | "idp";

export type IntegrationStatus =
  /** Implemented and connectable today. */
  | "available"
  /** Declared, but the subproject is not built yet. Rendered as forthcoming,
   *  never with a connect button that fails on click. */
  | "planned";

export type IntegrationDefinition = {
  id: string;
  type: IntegrationType;
  /** The vendor's name, as a buyer's IT admin would recognize it. */
  name: string;
  /** One line, on the integrations list. */
  summary: string;
  capabilities: Capability[];
  status: IntegrationStatus;
  /** Which phase of docs/todo.md builds or built it — shown for `planned`. */
  plannedIn?: string;
  /** Where the subproject lives. */
  subproject: string;
};

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: "epicor",
    type: "erp",
    name: "Epicor Kinetic",
    summary:
      "Mirrors purchase orders, suppliers and vendor pricing from Kinetic, and surfaces the PO suggestions its MRP run produces.",
    // po_suggestions is read-only on our side: a suggestion cannot be created
    // through Epicor's REST API at all, and none is ever fabricated here.
    capabilities: ["po_sync", "po_suggestions", "supplier_sync", "price_list_sync"],
    status: "available",
    subproject: "integrations/erp/epicor",
  },
  {
    id: "okta",
    type: "idp",
    name: "Okta",
    summary:
      "Signs your team in through Okta over OIDC or SAML, and creates and deactivates ZenoSource users from your directory.",
    // Never all three at once for one tenant: a connection carries one protocol,
    // so a health check verifies `sso_oidc` XOR `sso_saml`, plus provisioning.
    capabilities: ["sso_oidc", "sso_saml", "scim_provisioning"],
    status: "available",
    subproject: "integrations/idp/okta",
  },
];

export const INTEGRATIONS_BY_ID = new Map(INTEGRATIONS.map((i) => [i.id, i]));

export function getIntegration(id: string): IntegrationDefinition | undefined {
  return INTEGRATIONS_BY_ID.get(id);
}

/** Which integrations could supply a capability. */
export function integrationsProviding(capability: Capability): IntegrationDefinition[] {
  return INTEGRATIONS.filter((i) => i.capabilities.includes(capability));
}
