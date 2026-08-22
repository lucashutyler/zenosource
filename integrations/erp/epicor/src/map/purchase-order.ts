import type { CanonicalPurchaseOrder, CanonicalPurchaseOrderLine } from "../types";
import { bool, dateOnly, decimalString, field, int, text } from "./scalars";

// Erp.BO.POSvc -> PurchaseOrder + PurchaseOrderLine.
//
// Epicor models a PO in three levels — header (POes), line (PODetail),
// release (PORel) — and ZenoSource models two. The release level is where the
// dates and the received quantities actually live, so it cannot simply be
// dropped: a line with three releases is one ZenoSource line whose need-by is
// the earliest release still open and whose received quantity is the sum
// across releases. Collapsing it any other way loses the delivery schedule,
// which is the thing the whole product chases.

/**
 * Epicor status -> PurchaseOrderStatus, or null to leave ours alone.
 *
 * `null` is the important return. docs/architecture.md#data-boundaries: the
 * ERP owns the fields it owns, and ZenoSource "layers collaboration state
 * (acknowledgment, proposed changes, supplier-facing status) on top rather
 * than treating its own copy as canonical." Epicor has no concept of a
 * supplier acknowledging through ZenoSource, so an open, approved Epicor PO
 * maps to ISSUED at most — never to ACKNOWLEDGED, and never *back* from
 * ACKNOWLEDGED to ISSUED on the next sync. Returning null for the ambiguous
 * cases is what stops a nightly sync quietly erasing a supplier's
 * acknowledgment and re-chasing them for something they already answered.
 */
export function mapStatus(row: Record<string, unknown>): CanonicalPurchaseOrder["status"] {
  const voided = bool(field(row, "VoidOrder")) ?? false;
  if (voided) return "CANCELLED";

  const open = bool(field(row, "OpenOrder"));
  const approved = bool(field(row, "Approve", "Approved")) ?? false;

  if (open === false) {
    // Closed in Epicor. Whether that was fulfilment or abandonment isn't
    // recoverable from the header, and CLOSED is the honest floor: it is
    // terminal in ZenoSource too, so nothing keeps being chased.
    return "CLOSED";
  }
  if (!approved) return "DRAFT";
  // Approved and open. Everything past this point — acknowledged, part
  // received, fulfilled — is either ours or the release level's to say.
  return "ISSUED";
}

export type EpicorPORow = Record<string, unknown>;

export function mapPurchaseOrder(
  header: EpicorPORow,
  details: EpicorPORow[],
  releases: EpicorPORow[]
): CanonicalPurchaseOrder | null {
  const poNum = text(field(header, "PONum", "PONumber"));
  const supplierExternalRef = text(field(header, "VendorNum"));
  if (!poNum || !supplierExternalRef) return null;

  const releasesByLine = new Map<number, EpicorPORow[]>();
  for (const release of releases) {
    const line = int(field(release, "POLine"));
    if (line === undefined) continue;
    const bucket = releasesByLine.get(line);
    if (bucket) bucket.push(release);
    else releasesByLine.set(line, [release]);
  }

  const lines: CanonicalPurchaseOrderLine[] = [];
  for (const detail of details) {
    const line = mapLine(poNum, detail, releasesByLine.get(int(field(detail, "POLine")) ?? -1) ?? []);
    if (line) lines.push(line);
  }

  return {
    externalRef: poNum,
    externalNumber: poNum,
    supplierExternalRef,
    status: mapStatus(header),
    orderDate: dateOnly(field(header, "OrderDate")) ?? null,
    lines,
    changedAt: text(field(header, "ChangeDate", "SysRevID")) ?? null,
  };
}

function mapLine(
  poNum: string,
  detail: EpicorPORow,
  releases: EpicorPORow[]
): CanonicalPurchaseOrderLine | null {
  const lineNumber = int(field(detail, "POLine"));
  const itemNumber = text(field(detail, "PartNum", "VenPartNum", "CommodityCode"));
  const quantity = decimalString(field(detail, "OrderQty", "XOrderQty"));
  const unitPrice = decimalString(field(detail, "UnitCost", "DocUnitCost"));

  // A line without a quantity or a price is not a line we can chase — the
  // ledger ranks by dwell x value and a null value silently sorts to the
  // bottom, which is worse than not importing it. Skipped, and counted as
  // skipped in the sync run so it is visible rather than absent.
  if (lineNumber === undefined || !itemNumber || !quantity || !unitPrice) return null;

  const openReleases = releases.filter((r) => (bool(field(r, "OpenRelease")) ?? true) !== false);
  const dateSource = openReleases.length > 0 ? openReleases : releases;

  // The earliest still-open release is what the buyer is actually waiting on.
  const needByDate = earliest(dateSource.map((r) => dateOnly(field(r, "DueDate"))));
  const promiseDate = earliest(dateSource.map((r) => dateOnly(field(r, "PromiseDt", "PromiseDate"))));

  // Received quantity sums across every release, open or not — a closed
  // release still delivered its goods.
  const received = sumDecimals(releases.map((r) => field(r, "ReceivedQty", "RelQtyReceived")));

  return {
    externalRef: `${poNum}-${lineNumber}`,
    lineNumber,
    itemNumber,
    description: text(field(detail, "LineDesc", "PartDescription", "Description")) ?? itemNumber,
    uom: text(field(detail, "IUM", "PUM", "UOMCode")) ?? "EA",
    quantity,
    unitPrice,
    needByDate: needByDate ?? dateOnly(field(detail, "DueDate")) ?? null,
    promiseDate: promiseDate ?? null,
    // Epicor's site code, resolved against Location.externalRef by the
    // platform. Taken from the release because that is where Epicor puts the
    // plant — the same line can ship to two sites.
    locationRef: text(field(dateSource[0] ?? {}, "Plant", "PlantID")) ?? null,
    receivedQuantity: received ?? null,
  };
}

function earliest(dates: (string | undefined)[]): string | undefined {
  // ISO date strings sort lexicographically, which is the whole reason the
  // canonical form is YYYY-MM-DD and not a Date object.
  const present = dates.filter((d): d is string => Boolean(d)).sort();
  return present[0];
}

function sumDecimals(values: unknown[]): string | undefined {
  let total = 0;
  let sawOne = false;
  for (const value of values) {
    const asString = decimalString(value);
    if (asString === undefined) continue;
    sawOne = true;
    total += Number(asString);
  }
  return sawOne ? decimalString(total) : undefined;
}
