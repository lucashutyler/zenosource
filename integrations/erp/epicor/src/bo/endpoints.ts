// Where each capability lives on a Kinetic instance.
//
// Two things are true at once here, and both matter:
//
// 1. The *services* are stable and documented — `Erp.BO.VendorSvc`,
//    `Erp.BO.POSvc`, `Erp.BO.POSuggSvc`, `Erp.BO.VendPartSvc` are the ones
//    docs/integrations.md#epicor-erp names, and they are what integrators
//    actually use.
// 2. The *entity-set* names under them, and the exact column spellings in
//    map/, vary by Kinetic version and by whether a site has customized its
//    BOs. Nothing in this package has been run against a live Kinetic
//    instance — docs/todo.md Phase 5 carries "identify a design-partner/pilot
//    customer to validate the Epicor integration against a real Kinetic
//    instance" precisely because that validation is not something this code
//    can do for itself.
//
// So every version-sensitive name is collected here, and every one can be
// overridden per connection. Adapting to a pilot customer's instance is then
// a config change on one screen, not a hunt through mapping code. That is the
// difference between "we'll fix it in the next release" and "we'll fix it on
// the call".

export type ResourceEndpoint = {
  service: string;
  resource: string;
  /** The last-changed column, for incremental pulls. Absent = always full. */
  changedField?: string;
};

export const DEFAULT_ENDPOINTS = {
  suppliers: {
    service: "Erp.BO.VendorSvc",
    resource: "Vendors",
    changedField: "ChangeDate",
  },
  purchaseOrders: {
    service: "Erp.BO.POSvc",
    resource: "POes",
    changedField: "ChangeDate",
  },
  purchaseOrderLines: {
    service: "Erp.BO.POSvc",
    resource: "PODetails",
  },
  purchaseOrderReleases: {
    service: "Erp.BO.POSvc",
    resource: "PORels",
  },
  poSuggestions: {
    service: "Erp.BO.POSuggSvc",
    resource: "POSuggs",
  },
  vendorParts: {
    service: "Erp.BO.VendPartSvc",
    resource: "VendParts",
    changedField: "ChangeDate",
  },
} as const satisfies Record<string, ResourceEndpoint>;

export type EndpointKey = keyof typeof DEFAULT_ENDPOINTS;

/**
 * Per-connection overrides, read from the stored config under
 * `endpoints: { purchaseOrders: { resource: "POHeaders" } }`.
 */
export function endpointFor(
  key: EndpointKey,
  config: Record<string, unknown>
): ResourceEndpoint {
  const base = DEFAULT_ENDPOINTS[key] as ResourceEndpoint;
  const overrides = (config.endpoints as Record<string, Partial<ResourceEndpoint>> | undefined)?.[key];
  return overrides ? { ...base, ...overrides } : base;
}

/**
 * Which endpoint proves a capability is actually reachable. The health check
 * probes each of these, which is what lets a connection report that it can do
 * three of the four things Epicor declares — an API key's Access Scope is
 * per-service, so a partial grant is the normal case, not an edge one.
 */
export const CAPABILITY_PROBES: Record<string, EndpointKey> = {
  supplier_sync: "suppliers",
  po_sync: "purchaseOrders",
  po_suggestions: "poSuggestions",
  price_list_sync: "vendorParts",
};
