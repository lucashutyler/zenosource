// Which integrations exist, and what each one provides.
//
// Code, not rows. Every tenant sees the same list; only *connection* state is
// per-tenant (src/lib/integrations/connections.ts). Keeping declarations in
// code means adding an integration is a directory under integrations/ plus an
// entry here — not a migration, and not a seed script every environment has
// to be kept in step with.
//
// Adding one is the four steps in docs/integrations.md#adding-a-new-integration.
// Step 4 — "document what capability it provides" — is enforced here rather
// than trusted: registry.test.ts fails the build if a declared capability
// unlocks nothing, or if a feature requires a capability nothing supplies.

import type { Capability } from "./capabilities";

export type IntegrationType = "erp" | "idp";

export type IntegrationStatus =
  /** Implemented and connectable today. */
  | "available"
  /** Declared so the model is provably not single-vendor-shaped, but the
   *  subproject isn't built yet. Rendered as forthcoming, never with a
   *  connect button that fails on click. */
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
  /** Where the subproject lives, for anyone reading the list and wondering. */
  subproject: string;
};

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: "epicor",
    type: "erp",
    name: "Epicor Kinetic",
    summary:
      "Mirrors purchase orders, suppliers and vendor pricing from Kinetic, and surfaces the PO suggestions its MRP run produces.",
    // Exactly the set docs/architecture.md names. po_suggestions is read-only
    // on our side and always will be: Epicor's pipeline is demand -> MRP ->
    // requisition -> suggestion -> firm PO, and suggestions cannot be created
    // through REST at all (docs/integrations.md#epicor-erp). A buyer acting on
    // one here pushes a decision back through the requisition path; we never
    // fabricate a suggestion, so "generate suggestions without an ERP" is not
    // a feature we are one sprint away from — it's outside the data model.
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
    // Never all three at once for one tenant: a connection carries one
    // protocol, so its health check verifies `sso_oidc` XOR `sso_saml`, plus
    // `scim_provisioning` always — we are the directory server, so there is
    // nothing outbound to probe for it.
    capabilities: ["sso_oidc", "sso_saml", "scim_provisioning"],
    status: "available",
    subproject: "integrations/idp/okta",
  },
];

export const INTEGRATIONS_BY_ID = new Map(INTEGRATIONS.map((i) => [i.id, i]));

export function getIntegration(id: string): IntegrationDefinition | undefined {
  return INTEGRATIONS_BY_ID.get(id);
}

/** Which integrations could supply a capability — the "connect one of these" list. */
export function integrationsProviding(capability: Capability): IntegrationDefinition[] {
  return INTEGRATIONS.filter((i) => i.capabilities.includes(capability));
}
