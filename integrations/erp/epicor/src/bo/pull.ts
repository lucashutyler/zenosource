import { EpicorClient, changedSinceFilter } from "../client";
import type { EpicorConfig } from "../config";
import { endpointFor } from "./endpoints";
import { mapSupplier } from "../map/supplier";
import { mapPurchaseOrder } from "../map/purchase-order";
import { mapPriceLists } from "../map/price-list";
import { mapSuggestion } from "../map/suggestion";
import type {
  CanonicalPOSuggestion,
  CanonicalPriceList,
  CanonicalPurchaseOrder,
  CanonicalSupplier,
  PullOptions,
} from "../types";

// The read side: BO pages in, canonical batches out.
//
// Everything here yields batches rather than accumulating. A real Kinetic
// instance holds tens of thousands of PO releases and the platform commits a
// page at a time, so a failure at record 9,000 keeps the first 8,999 — which
// is what IntegrationSyncRun's PARTIAL outcome exists to record.

type Row = Record<string, unknown>;

export async function* pullSuppliers(
  client: EpicorClient,
  config: EpicorConfig,
  options: PullOptions = {}
): AsyncGenerator<CanonicalSupplier[]> {
  const endpoint = endpointFor("suppliers", config as unknown as Row);
  const filter = endpoint.changedField
    ? changedSinceFilter(endpoint.changedField, options.since)
    : undefined;

  for await (const page of client.pages<Row>(endpoint.service, endpoint.resource, {
    $filter: filter,
  })) {
    const mapped = page.map(mapSupplier).filter((s): s is CanonicalSupplier => s !== null);
    if (mapped.length > 0) yield mapped;
  }
}

/**
 * Headers first, then the details and releases belonging to that page.
 *
 * The alternative — one request per PO for its children — is what makes ERP
 * syncs take hours: a 4,000-order first sync becomes 12,000 round trips. This
 * is three requests per page of 200 orders. The `$expand` that would make it
 * one is deliberately not used: Kinetic's OData expand on POSvc is
 * inconsistent across versions and silently caps child collections on some,
 * which loses lines with no error at all — and a PO that imports with four of
 * its seven lines is worse than one that fails outright.
 */
export async function* pullPurchaseOrders(
  client: EpicorClient,
  config: EpicorConfig,
  options: PullOptions = {}
): AsyncGenerator<CanonicalPurchaseOrder[]> {
  const headerEndpoint = endpointFor("purchaseOrders", config as unknown as Row);
  const detailEndpoint = endpointFor("purchaseOrderLines", config as unknown as Row);
  const releaseEndpoint = endpointFor("purchaseOrderReleases", config as unknown as Row);

  const filter = headerEndpoint.changedField
    ? changedSinceFilter(headerEndpoint.changedField, options.since)
    : undefined;

  for await (const headers of client.pages<Row>(
    headerEndpoint.service,
    headerEndpoint.resource,
    { $filter: filter },
    200
  )) {
    const poNums = headers
      .map((h) => h.PONum ?? h.PONumber)
      .filter((n): n is string | number => n !== undefined && n !== null);
    if (poNums.length === 0) continue;

    const [details, releases] = await Promise.all([
      fetchChildren(client, detailEndpoint.service, detailEndpoint.resource, poNums),
      fetchChildren(client, releaseEndpoint.service, releaseEndpoint.resource, poNums),
    ]);

    const detailsByPO = groupBy(details, (r) => String(r.PONum ?? ""));
    const releasesByPO = groupBy(releases, (r) => String(r.PONum ?? ""));

    const mapped = headers
      .map((header) => {
        const key = String(header.PONum ?? header.PONumber ?? "");
        return mapPurchaseOrder(header, detailsByPO.get(key) ?? [], releasesByPO.get(key) ?? []);
      })
      .filter((po): po is CanonicalPurchaseOrder => po !== null);

    if (mapped.length > 0) yield mapped;
  }
}

/**
 * `PONum eq 1 or PONum eq 2 or ...`, chunked.
 *
 * Not OData's `in` operator, which reads better and which Kinetic supports
 * only from some versions — falling back on a rejected filter mid-sync is a
 * worse failure than a longer URL. Chunked at 50 because a filter string is a
 * query parameter and both IIS and Kinetic's own gateway cap URL length; the
 * cap that bites is somewhere above this, and 50 leaves room for a
 * customized instance with longer field names.
 */
async function fetchChildren(
  client: EpicorClient,
  service: string,
  resource: string,
  poNums: (string | number)[]
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < poNums.length; i += 50) {
    const chunk = poNums.slice(i, i + 50);
    const filter = chunk.map((n) => `PONum eq ${typeof n === "number" ? n : `'${n}'`}`).join(" or ");
    for await (const page of client.pages<Row>(service, resource, { $filter: filter }, 1000)) {
      rows.push(...page);
    }
  }
  return rows;
}

export async function* pullPriceLists(
  client: EpicorClient,
  config: EpicorConfig,
  options: PullOptions = {}
): AsyncGenerator<CanonicalPriceList[]> {
  const endpoint = endpointFor("vendorParts", config as unknown as Row);
  const filter = endpoint.changedField
    ? changedSinceFilter(endpoint.changedField, options.since)
    : undefined;

  for await (const page of client.pages<Row>(endpoint.service, endpoint.resource, {
    $filter: filter,
    // Quantity breaks are children of the vendor-part row. Unlike POSvc's
    // expand, this one is a single small child collection and is well-behaved
    // — and without it every part would need its own request.
    $expand: "VendPBrks",
  })) {
    const mapped = mapPriceLists(page);
    if (mapped.length > 0) yield mapped;
  }
}

export async function* pullPOSuggestions(
  client: EpicorClient,
  config: EpicorConfig,
  // Suggestions are always pulled in full. MRP rewrites the whole set on each
  // run, so an incremental pull would miss withdrawals — and a withdrawn
  // suggestion left OPEN means chasing a buyer to act on demand that no
  // longer exists.
  _options: PullOptions = {}
): AsyncGenerator<CanonicalPOSuggestion[]> {
  const endpoint = endpointFor("poSuggestions", config as unknown as Row);

  for await (const page of client.pages<Row>(endpoint.service, endpoint.resource)) {
    const mapped = page.map(mapSuggestion).filter((s): s is CanonicalPOSuggestion => s !== null);
    if (mapped.length > 0) yield mapped;
  }
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}
