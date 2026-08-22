// The canonical shapes this connector produces, restated here.
//
// This package deliberately depends on nothing — not on the platform, not on
// Prisma, not on any runtime library. That is what makes it independently
// deployable (docs/architecture.md) and what stops Epicor's vocabulary
// leaking upward. The cost is that these types are a structural restatement
// of apps/platform/src/lib/integrations/contract.ts rather than an import of
// it, and the two could drift.
//
// The platform's `conformance.test.ts` is what makes drift a build failure
// instead of a runtime surprise: it assigns this package's connector to the
// platform's `ErpConnector` interface, so any mismatch in either direction is
// a type error. Restating the types is a deliberate trade — an inverted
// dependency (this package importing the platform) would be far worse, and a
// third shared package is unwarranted for one connector.

export type DecimalString = string;
export type DateOnlyString = string;
export type TimestampString = string;

export type CanonicalSupplier = {
  externalRef: string;
  name: string;
  primaryContactName?: string | null;
  primaryContactEmail?: string | null;
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
  locationRef?: string | null;
  receivedQuantity?: DecimalString | null;
};

export type CanonicalPurchaseOrder = {
  externalRef: string;
  externalNumber: string;
  supplierExternalRef: string;
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
  changedAt?: TimestampString | null;
};

export type CanonicalPriceBreak = {
  minQuantity: number;
  unitPrice: DecimalString;
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
  withdrawn?: boolean;
};

export type HealthFailureKind =
  | "NONE"
  | "API_KEY"
  | "IDENTITY"
  | "UNREACHABLE"
  | "CONFIGURATION";

export type HealthReport = {
  healthy: boolean;
  failure: HealthFailureKind;
  detail?: string;
  verifiedCapabilities?: string[];
};

export type PurchaseOrderWriteBack = {
  poExternalRef: string;
  lineExternalRef: string;
  promiseDate?: DateOnlyString | null;
  quantity?: DecimalString | null;
  unitPrice?: DecimalString | null;
  acknowledged?: boolean;
};

export type SuggestionDecision = {
  suggestionExternalRef: string;
  decision: "ACCEPT" | "REJECT";
  quantity?: DecimalString | null;
  needByDate?: DateOnlyString | null;
  reason?: string | null;
};

export type WriteBackResult = {
  ok: boolean;
  externalRef?: string;
  detail?: string;
};

export type ConnectorSession = {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

export type Batch<T> = AsyncIterable<T[]>;

export type PullOptions = {
  since?: Date;
};
