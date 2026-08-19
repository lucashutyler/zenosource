import { EpicorClient, type ClientOptions } from "./client";
import { parseConfig, readSession, type EpicorConfig, type EpicorSecrets } from "./config";
import { checkHealth } from "./health";
import { pullPOSuggestions, pullPriceLists, pullPurchaseOrders, pullSuppliers } from "./bo/pull";
import { pushPurchaseOrderChange, pushSuggestionDecision } from "./baq";
import type {
  Batch,
  CanonicalPOSuggestion,
  CanonicalPriceList,
  CanonicalPurchaseOrder,
  CanonicalSupplier,
  ConnectorSession,
  HealthReport,
  PullOptions,
  PurchaseOrderWriteBack,
  SuggestionDecision,
  WriteBackResult,
} from "./types";

/**
 * Everything Epicor declares in the platform's registry. Restated here so the
 * health check knows what to probe without importing the platform.
 * registry.test.ts on the platform side and the conformance test together
 * keep the two lists honest.
 */
export const EPICOR_CAPABILITIES = [
  "po_sync",
  "po_suggestions",
  "supplier_sync",
  "price_list_sync",
] as const;

export class EpicorConnector {
  readonly integrationId = "epicor";

  constructor(private readonly options: ClientOptions = {}) {}

  parseConfig(raw: Record<string, unknown>) {
    const result = parseConfig(raw);
    if (!result.ok) return result;
    return {
      ok: true as const,
      config: result.config as unknown as Record<string, unknown>,
      secrets: result.secrets as unknown as Record<string, string>,
    };
  }

  async checkHealth(session: ConnectorSession): Promise<HealthReport> {
    const { config, secrets } = readSession(session);
    return checkHealth(this.client(config, secrets), config, EPICOR_CAPABILITIES);
  }

  pullSuppliers(session: ConnectorSession, options?: PullOptions): Batch<CanonicalSupplier> {
    const { config, secrets } = readSession(session);
    return pullSuppliers(this.client(config, secrets), config, options);
  }

  pullPurchaseOrders(
    session: ConnectorSession,
    options?: PullOptions
  ): Batch<CanonicalPurchaseOrder> {
    const { config, secrets } = readSession(session);
    return pullPurchaseOrders(this.client(config, secrets), config, options);
  }

  pullPriceLists(session: ConnectorSession, options?: PullOptions): Batch<CanonicalPriceList> {
    const { config, secrets } = readSession(session);
    return pullPriceLists(this.client(config, secrets), config, options);
  }

  pullPOSuggestions(
    session: ConnectorSession,
    options?: PullOptions
  ): Batch<CanonicalPOSuggestion> {
    const { config, secrets } = readSession(session);
    return pullPOSuggestions(this.client(config, secrets), config, options);
  }

  async pushPurchaseOrderChange(
    session: ConnectorSession,
    change: PurchaseOrderWriteBack
  ): Promise<WriteBackResult> {
    const { config, secrets } = readSession(session);
    return pushPurchaseOrderChange(this.client(config, secrets), config, change);
  }

  async pushSuggestionDecision(
    session: ConnectorSession,
    decision: SuggestionDecision
  ): Promise<WriteBackResult> {
    const { config, secrets } = readSession(session);
    return pushSuggestionDecision(this.client(config, secrets), config, decision);
  }

  /**
   * A fresh client per call rather than one per connector. The connector is a
   * module-level singleton shared across every tenant in the process, and a
   * cached client would hold one tenant's OAuth2 bearer token where another
   * tenant's request could pick it up — a cross-tenant credential leak, which
   * docs/integrations.md calls "a severe multi-tenancy breach, not just a
   * permissions bug" in the SCIM context. The same rule applies here.
   */
  private client(config: EpicorConfig, secrets: EpicorSecrets): EpicorClient {
    return new EpicorClient(config, secrets, this.options);
  }
}

export const epicorConnector = new EpicorConnector();
