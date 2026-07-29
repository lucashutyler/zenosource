import { describe, it, expect } from "vitest";
import {
  ACTION_COPY,
  PO_COURT,
  PO_EXPECTED_ACTION,
  PO_STATUS_LABEL,
  RFQ_COURT,
  RFQ_EXPECTED_ACTION,
  RFQ_STATUS_LABEL,
  UNCHASED_STATUSES,
  whatsOwed,
} from "./lifecycle";
import type { ActionItemType } from "@/generated/prisma/enums";

// The executable version of the product's central claim.
//
// docs/product.md: "every state a PO or RFQ can be in resolves to an open
// action owned by someone... a status nobody is being reminded to act on is a
// modeling bug." That's only true if something enforces it. These tests are
// that something — a new status added to the schema without a decision about
// who owes what fails here rather than shipping as a silent dead end.

describe("no unowned states", () => {
  it("every purchase-order status either mints an action item or is a declared exception", () => {
    for (const status of Object.keys(PO_STATUS_LABEL) as (keyof typeof PO_STATUS_LABEL)[]) {
      const expected = PO_EXPECTED_ACTION[status];
      if (expected === null) {
        const declared = UNCHASED_STATUSES.find(
          (u) => u.entity === "PurchaseOrder" && u.status === status
        );
        expect(declared, `PurchaseOrder.${status} mints no action item and isn't declared as unchased`).toBeTruthy();
        expect(declared!.because.length).toBeGreaterThan(20);
      } else {
        expect(ACTION_COPY[expected], `${status} maps to an action type with no copy`).toBeTruthy();
      }
    }
  });

  it("every RFQ status either mints an action item or is a declared exception", () => {
    for (const status of Object.keys(RFQ_STATUS_LABEL) as (keyof typeof RFQ_STATUS_LABEL)[]) {
      const expected = RFQ_EXPECTED_ACTION[status];
      if (expected === null) {
        const declared = UNCHASED_STATUSES.find((u) => u.entity === "RFQ" && u.status === status);
        expect(declared, `RFQ.${status} mints no action item and isn't declared as unchased`).toBeTruthy();
      } else {
        expect(ACTION_COPY[expected]).toBeTruthy();
      }
    }
  });

  it("only terminal statuses are allowed to be unchased", () => {
    for (const status of Object.keys(PO_STATUS_LABEL) as (keyof typeof PO_STATUS_LABEL)[]) {
      if (PO_EXPECTED_ACTION[status] === null) {
        expect(PO_COURT[status], `${status} owes nothing but is in someone's court`).toBe("NOBODY");
      } else {
        expect(PO_COURT[status]).not.toBe("NOBODY");
      }
    }
    for (const status of Object.keys(RFQ_STATUS_LABEL) as (keyof typeof RFQ_STATUS_LABEL)[]) {
      if (RFQ_EXPECTED_ACTION[status] === null) {
        expect(RFQ_COURT[status]).toBe("NOBODY");
      } else {
        expect(RFQ_COURT[status]).not.toBe("NOBODY");
      }
    }
  });

  it("the side that owes each action agrees with whose court the state is in", () => {
    for (const status of Object.keys(PO_STATUS_LABEL) as (keyof typeof PO_STATUS_LABEL)[]) {
      const expected = PO_EXPECTED_ACTION[status];
      if (!expected) continue;
      const side = ACTION_COPY[expected].side;
      expect(
        side === "SUPPLIER" ? "SUPPLIER" : "BUYER",
        `${status} is in the ${PO_COURT[status]} court but its action is owed by the ${side}`
      ).toBe(PO_COURT[status]);
    }
  });

  it("every action type has copy, and supplier-owed ones have external wording", () => {
    for (const [type, copy] of Object.entries(ACTION_COPY) as [ActionItemType, (typeof ACTION_COPY)[ActionItemType]][]) {
      expect(copy.label, `${type} has no internal label`).toBeTruthy();
      expect(copy.owes, `${type} has no owed-phrase`).toBeTruthy();
      if (copy.side === "SUPPLIER") {
        // Suppliers see this text. An enum name leaking onto the external
        // surface is the failure mode here.
        expect(copy.external, `${type} is supplier-owed but has no external wording`).toBeTruthy();
        expect(copy.external).not.toMatch(/_/);
      }
    }
  });
});

describe("whatsOwed", () => {
  it("names the supplier when the ball is in their court", () => {
    expect(whatsOwed({ actionType: "PO_ACKNOWLEDGE", supplierName: "Precision Parts" })).toBe(
      "Precision Parts: acknowledge"
    );
  });

  it("says You for the reader's own work and Us for a teammate's", () => {
    expect(
      whatsOwed({
        actionType: "PO_REVIEW_REJECTION",
        supplierName: "Titan",
        ownedByViewer: true,
      })
    ).toBe("You: respond to the rejection");
    expect(
      whatsOwed({ actionType: "PO_REVIEW_REJECTION", supplierName: "Titan", ownedByViewer: false })
    ).toBe("Us: respond to the rejection");
  });

  it("says nobody, with the settlement, for finished work", () => {
    expect(
      whatsOwed({ actionType: null, supplierName: "Titan", settled: "closed 14 Jun" })
    ).toBe("Nobody — closed 14 Jun");
  });
});
