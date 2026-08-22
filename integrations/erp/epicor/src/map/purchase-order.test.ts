import { describe, it, expect } from "vitest";
import { mapPurchaseOrder, mapStatus } from "./purchase-order";

const header = {
  PONum: 12345,
  VendorNum: 42,
  OrderDate: "2026-08-01T00:00:00-07:00",
  OpenOrder: true,
  Approve: true,
  ChangeDate: "2026-08-10T09:00:00Z",
};

describe("status mapping", () => {
  it("maps an approved open order to ISSUED, never further", () => {
    // The ceiling is deliberate. Epicor has no concept of a supplier
    // acknowledging through ZenoSource, so mapping an open PO to ACKNOWLEDGED
    // would invent a fact; mapping it *back* to ISSUED on the next nightly
    // sync would erase one. docs/architecture.md#data-boundaries: the ERP owns
    // the fields it owns, and acknowledgment is ours.
    expect(mapStatus(header)).toBe("ISSUED");
  });

  it("maps an unapproved order to DRAFT and a voided one to CANCELLED", () => {
    expect(mapStatus({ ...header, Approve: false })).toBe("DRAFT");
    expect(mapStatus({ ...header, VoidOrder: true })).toBe("CANCELLED");
  });

  it("maps a closed order to CLOSED, which is terminal on both sides", () => {
    expect(mapStatus({ ...header, OpenOrder: false })).toBe("CLOSED");
  });

  it("treats a void order as cancelled even while it still reads as open and approved", () => {
    expect(mapStatus({ ...header, VoidOrder: true, OpenOrder: true, Approve: true })).toBe("CANCELLED");
  });
});

describe("collapsing Epicor's three levels into ZenoSource's two", () => {
  const details = [
    { PONum: 12345, POLine: 1, PartNum: "SKU-1001", LineDesc: "Bracket", IUM: "EA", OrderQty: 500, UnitCost: 8.755 },
  ];

  it("takes need-by from the earliest still-open release", () => {
    const releases = [
      { PONum: 12345, POLine: 1, PORelNum: 1, DueDate: "2026-09-01T00:00:00-07:00", OpenRelease: false, ReceivedQty: 200 },
      { PONum: 12345, POLine: 1, PORelNum: 2, DueDate: "2026-08-14T00:00:00-07:00", OpenRelease: true, ReceivedQty: 0 },
      { PONum: 12345, POLine: 1, PORelNum: 3, DueDate: "2026-10-01T00:00:00-07:00", OpenRelease: true, ReceivedQty: 0 },
    ];
    const po = mapPurchaseOrder(header, details, releases)!;

    // The 1 Sep release is earlier than 1 Oct but already closed — the buyer
    // is waiting on 14 Aug. Picking the earliest release overall would show a
    // date that has nothing left to deliver against it.
    expect(po.lines[0].needByDate).toBe("2026-08-14");
  });

  it("sums received quantity across every release, closed ones included", () => {
    const releases = [
      { PONum: 12345, POLine: 1, PORelNum: 1, OpenRelease: false, ReceivedQty: 200 },
      { PONum: 12345, POLine: 1, PORelNum: 2, OpenRelease: true, ReceivedQty: 50 },
    ];
    const po = mapPurchaseOrder(header, details, releases)!;
    expect(po.lines[0].receivedQuantity).toBe("250.0000");
  });

  it("keeps each line's releases apart", () => {
    const twoLines = [
      ...details,
      { PONum: 12345, POLine: 2, PartNum: "SKU-2050", LineDesc: "Housing", IUM: "EA", OrderQty: 10, UnitCost: 44 },
    ];
    const releases = [
      { PONum: 12345, POLine: 1, DueDate: "2026-08-14T00:00:00Z", OpenRelease: true },
      { PONum: 12345, POLine: 2, DueDate: "2026-12-25T00:00:00Z", OpenRelease: true },
    ];
    const po = mapPurchaseOrder(header, twoLines, releases)!;
    expect(po.lines.find((l) => l.lineNumber === 1)!.needByDate).toBe("2026-08-14");
    expect(po.lines.find((l) => l.lineNumber === 2)!.needByDate).toBe("2026-12-25");
  });

  it("skips a line with no price rather than importing it at zero", () => {
    // A null value sorts to the bottom of a ledger that ranks by dwell x
    // value, so a priceless line would be quietly deprioritized forever.
    // Better absent and counted as skipped than present and wrong.
    const broken = [{ PONum: 12345, POLine: 9, PartNum: "SKU-X", OrderQty: 5 }];
    const po = mapPurchaseOrder(header, broken, [])!;
    expect(po.lines).toHaveLength(0);
  });

  it("carries the site code through for the platform to resolve", () => {
    const releases = [{ PONum: 12345, POLine: 1, OpenRelease: true, Plant: "MAIN" }];
    const po = mapPurchaseOrder(header, details, releases)!;
    expect(po.lines[0].locationRef).toBe("MAIN");
  });

  it("returns null for a header with no supplier — an unattributable PO is not importable", () => {
    expect(mapPurchaseOrder({ PONum: 1 }, [], [])).toBeNull();
  });

  it("uses VendorNum, the key Epicor's own foreign keys use", () => {
    const po = mapPurchaseOrder({ ...header, VendorID: "ACME" }, details, [])!;
    expect(po.supplierExternalRef).toBe("42");
  });
});
