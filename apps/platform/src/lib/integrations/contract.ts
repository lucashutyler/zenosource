// The connector contract: what the platform requires of any ERP integration,
// stated in the platform's own vocabulary.
//
// docs/integrations.md#adding-a-new-integration step 3: "map its native
// data/protocol to ZenoSource's canonical entities — don't leak vendor-
// specific shapes (Epicor's BO names, Okta's SCIM schema, etc.) into core
// platform code." This file is where that rule is made mechanical. Nothing
// below names a vendor. An integration is a module that satisfies
// `ErpConnector`; the platform never imports anything else from it, and
// `src/lib/integrations/conformance.test.ts` is what proves the fit for
// Epicor at build time rather than at first sync.
//
// Direction of dependency, deliberately: integrations/erp/epicor depends on
// nothing here — it is a standalone package with no Prisma and no Next — and
// the platform depends on it. TypeScript's structural typing makes that work
// without a shared package to keep in step, and the conformance test is what
// catches drift. Once the Phase 6 hosting decision is made, the same
// interface can sit behind an HTTP call without any caller changing.

// --- Scalars ---------------------------------------------------------------
//
// Decimals cross this boundary as strings, never as numbers. Quantities and
// unit prices are Decimal(14,4) in the database and an ERP will happily send
// values that lose precision as a float — and the one time this product
// carried an unbounded number it produced a $12 trillion purchase order and a
// numeric overflow (docs/todo.md Phase 1b). A string survives the trip
// exactly; the platform parses it once, at the edge.

/** A fixed-point number as it appears on the wire, e.g. `"8.7550"`. */
export type DecimalString = string;

/** A date with no time or zone, `YYYY-MM-DD`. */
export type DateOnlyString = string;

/** An instant, ISO 8601 with an offset. */
export type TimestampString = string;

// --- Canonical records -----------------------------------------------------
//
// One per entity in docs/data-model.md that an ERP can own. Every one carries
// `externalRef`: the ERP's own stable key, which is what makes a sync
// idempotent — records are matched on (sourceIntegrationId, externalRef), so
// re-running a sync updates rather than duplicating.

export type CanonicalSupplier = {
  externalRef: string;
  name: string;
  primaryContactName?: string | null;
  primaryContactEmail?: string | null;
  /** The ERP's own active/inactive flag. Inactive suppliers stop being chased. */
  active: boolean;
};

export type CanonicalPurchaseOrderLine = {
  externalRef: string;
  lineNumber: number;
  itemNumber: string;
  description: string;
  uom: string;
  quantity: DecimalString;
  unitPrice: DecimalString;
  needByDate?: DateOnlyString | null;
  promiseDate?: DateOnlyString | null;
  /**
   * The ERP's site/plant code. Resolved against Location.externalRef by the
   * platform — an unmatched code is a skipped line with a reason, not a line
   * silently attached to the wrong site, because Location is an access-control
   * boundary (docs/architecture.md#tenancy--users) and guessing it wrong hands
   * a MEMBER another site's orders.
   */
  locationRef?: string | null;
  /** Received-to-date, when the ERP tracks receipts. */
  receivedQuantity?: DecimalString | null;
};

export type CanonicalPurchaseOrder = {
  externalRef: string;
  /** The ERP's own PO number, kept for reconciliation. Not ZenoSource's `P-10418`. */
  externalNumber: string;
  supplierExternalRef: string;
  /**
   * Mapped to PurchaseOrderStatus by the integration, because only it knows
   * what its own status codes mean. `null` means the ERP's state has no
   * ZenoSource equivalent and the platform should leave its own status alone
   * — a mirrored field must never overwrite collaboration state the ERP
   * cannot see (docs/architecture.md#data-boundaries: the ERP owns the fields
   * it owns; acknowledgment and proposed changes are ours).
   */
  status:
    | "DRAFT"
    | "ISSUED"
    | "ACKNOWLEDGED"
    | "IN_PROGRESS"
    | "FULFILLED"
    | "CLOSED"
    | "CANCELLED"
    | null;
  orderDate?: DateOnlyString | null;
  lines: CanonicalPurchaseOrderLine[];
  /** ERP's last-modified stamp, used as the incremental watermark. */
  changedAt?: TimestampString | null;
};

export type CanonicalPriceBreak = {
  minQuantity: number;
  unitPrice: DecimalString;
  /** USD-only in v1 (docs/todo.md Phase 1b decision 2); a non-USD break is skipped with a reason. */
  currency: string;
};

export type CanonicalPriceListItem = {
  itemNumber: string;
  description: string;
  uom: string;
  breaks: CanonicalPriceBreak[];
};

export type CanonicalPriceList = {
  externalRef: string;
  supplierExternalRef: string;
  effectiveFrom?: DateOnlyString | null;
  effectiveTo?: DateOnlyString | null;
  items: CanonicalPriceListItem[];
};

export type CanonicalPOSuggestion = {
  externalRef: string;
  supplierExternalRef: string;
  itemNumber: string;
  description: string;
  suggestedQuantity: DecimalString;
  suggestedDate: DateOnlyString;
  suggestedUnitPrice?: DecimalString | null;
  /** True once the ERP no longer offers it — MRP reran, or it was firmed elsewhere. */
  withdrawn?: boolean;
};

// --- Health ----------------------------------------------------------------

/**
 * Mirrors IntegrationHealthFailure in the schema. Named here too so the
 * integration package can classify its own failures without importing the
 * platform's generated Prisma enums — which would invert the dependency and
 * drag Prisma into a package that has no database.
 */
export type HealthFailureKind =
  | "NONE"
  | "API_KEY"
  | "IDENTITY"
  | "UNREACHABLE"
  | "CONFIGURATION";

export type HealthReport = {
  healthy: boolean;
  failure: HealthFailureKind;
  /** Operator-facing detail. Shown to a buyer's admin, never to a supplier. */
  detail?: string;
  /**
   * Which of the declared capabilities this instance can actually serve. An
   * Epicor instance whose API-key Access Scope omits POSuggSvc is healthy but
   * cannot supply `po_suggestions`, and pretending otherwise unlocks a
   * feature that then renders empty forever.
   */
  verifiedCapabilities?: string[];
};

// --- Write-back ------------------------------------------------------------

export type PurchaseOrderWriteBack = {
  poExternalRef: string;
  lineExternalRef: string;
  /** Supplier's promise date, once acknowledged. */
  promiseDate?: DateOnlyString | null;
  /** Agreed values after the buyer accepted a supplier's proposed change. */
  quantity?: DecimalString | null;
  unitPrice?: DecimalString | null;
  acknowledged?: boolean;
};

export type SuggestionDecision = {
  suggestionExternalRef: string;
  decision: "ACCEPT" | "REJECT";
  /** Set on ACCEPT when the buyer changed what MRP proposed. */
  quantity?: DecimalString | null;
  needByDate?: DateOnlyString | null;
  reason?: string | null;
};

export type WriteBackResult = {
  ok: boolean;
  /** The ERP's identifier for what it created, e.g. a requisition number. */
  externalRef?: string;
  detail?: string;
};

// --- The interface ---------------------------------------------------------

/**
 * Opaque to the platform: whatever the integration needs to talk to one
 * tenant's instance, already decrypted. The platform stores it sealed
 * (src/lib/integrations/secrets.ts) and hands it back without inspecting it.
 */
export type ConnectorSession = {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

/**
 * Batches, not single records. A real Kinetic instance holds tens of
 * thousands of PO releases, and the platform wants to commit a page at a time
 * so a failure at record 9,000 doesn't discard the first 8,999 — sync outcome
 * PARTIAL exists for exactly that.
 */
export type Batch<T> = AsyncIterable<T[]>;

export type PullOptions = {
  /**
   * Only records changed since this instant. Absent on a first sync (full
   * pull). The platform stores the returned watermark per resource, because
   * suppliers change monthly and PO releases change hourly.
   */
  since?: Date;
};

export interface ErpConnector {
  /** Must match an id in registry.ts. */
  readonly integrationId: string;

  /**
   * Validate and normalize what an admin typed on the connect form. Returning
   * errors keyed by field name lets the platform render them inline, the same
   * way every other form in the product does since Phase 1b Wave 1.
   */
  parseConfig(raw: Record<string, unknown>):
    | { ok: true; config: Record<string, unknown>; secrets: Record<string, string> }
    | { ok: false; errors: Record<string, string> };

  checkHealth(session: ConnectorSession): Promise<HealthReport>;

  pullSuppliers(session: ConnectorSession, options?: PullOptions): Batch<CanonicalSupplier>;
  pullPurchaseOrders(
    session: ConnectorSession,
    options?: PullOptions
  ): Batch<CanonicalPurchaseOrder>;
  pullPriceLists(session: ConnectorSession, options?: PullOptions): Batch<CanonicalPriceList>;
  pullPOSuggestions(
    session: ConnectorSession,
    options?: PullOptions
  ): Batch<CanonicalPOSuggestion>;

  pushPurchaseOrderChange(
    session: ConnectorSession,
    change: PurchaseOrderWriteBack
  ): Promise<WriteBackResult>;

  /**
   * Push a buyer's decision on an MRP suggestion. Never a write to the
   * suggestion itself — Epicor rejects that outright ("Suggestion is no
   * longer valid"); this goes through the requisition/approval path.
   */
  pushSuggestionDecision(
    session: ConnectorSession,
    decision: SuggestionDecision
  ): Promise<WriteBackResult>;
}

/** The canonical resources a sync run can cover, matching IntegrationSyncRun.resource. */
export const SYNC_RESOURCES = [
  "suppliers",
  "purchase_orders",
  "price_lists",
  "po_suggestions",
] as const;

export type SyncResource = (typeof SYNC_RESOURCES)[number];
