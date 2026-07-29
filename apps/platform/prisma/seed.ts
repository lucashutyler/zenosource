import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type {
  PurchaseOrderStatus,
  PurchaseOrderLineStatus,
  StatusEventSubjectType,
} from "../src/generated/prisma/enums";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

function accessToken() {
  return randomBytes(32).toString("hex");
}

// Deterministic pseudo-randomness. The volume data has to *look* varied —
// different suppliers behaving differently is the whole point of a scorecard —
// while staying byte-identical between runs, because the E2E suite reseeds
// before every run and asserts against what it finds.
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const DAY = 24 * 60 * 60 * 1000;

// A fixed "now" so backdated history lands at stable offsets. Uses the real
// clock only once, at the top, rather than per-record.
const NOW = new Date();
function daysAgo(days: number, hourOffset = 9): Date {
  const d = new Date(NOW.getTime() - days * DAY);
  d.setUTCHours(hourOffset, 0, 0, 0);
  return d;
}
function utcDate(base: Date, offsetDays: number): Date {
  const d = new Date(base.getTime() + offsetDays * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const SAMPLE_ITEMS = [
  { itemNumber: "SKU-1001", description: "M6 titanium bolt, 25mm", uom: "EA", unitPrice: 0.85 },
  { itemNumber: "SKU-2050", description: "Anodized aluminum bracket", uom: "EA", unitPrice: 4.2 },
  { itemNumber: "SKU-3100", description: "Stainless steel hex nut", uom: "EA", unitPrice: 0.32 },
  { itemNumber: "SKU-4200", description: "Carbon fiber panel, 12x12in", uom: "EA", unitPrice: 38.5 },
  { itemNumber: "SKU-5010", description: "Rubber gasket seal", uom: "EA", unitPrice: 1.15 },
  { itemNumber: "SKU-6300", description: "Copper wire spool, 100ft", uom: "SPOOL", unitPrice: 22.0 },
];

/**
 * Supplier personas with visibly different behaviour, so a ranking means
 * something. A scorecard seeded from uniform data ranks everybody equally and
 * proves only that the query runs.
 */
const SUPPLIER_SEEDS = [
  {
    name: "Precision Parts Co.",
    contactName: "Sam Supplier",
    email: "sam@precisionparts.test",
    // Fast, reliable, occasionally pushes price.
    ackDelayDays: 0.4,
    onTimeRate: 0.94,
    changeRate: 0.12,
    quoteRate: 0.9,
    quoteDelayDays: 1.5,
    priceIndex: 1.0,
  },
  {
    name: "Titan Fasteners Inc.",
    contactName: "Riley Titan",
    email: "riley@titanfasteners.test",
    // Cheap, slow to answer, slips dates.
    ackDelayDays: 4.5,
    onTimeRate: 0.61,
    changeRate: 0.34,
    quoteRate: 0.7,
    quoteDelayDays: 6,
    priceIndex: 0.88,
  },
  {
    name: "Northline Metal Supply",
    contactName: "Jamie North",
    email: "jamie@northlinemetal.test",
    ackDelayDays: 1.8,
    onTimeRate: 0.82,
    changeRate: 0.18,
    quoteRate: 0.85,
    quoteDelayDays: 3,
    priceIndex: 1.06,
  },
  {
    name: "Apex Electronics Components",
    contactName: "Morgan Apex",
    email: "morgan@apexelectronics.test",
    // The problem supplier: needs chasing, rarely on time.
    ackDelayDays: 8,
    onTimeRate: 0.44,
    changeRate: 0.41,
    quoteRate: 0.4,
    quoteDelayDays: 11,
    priceIndex: 0.95,
  },
  {
    name: "Coastal Packaging Solutions",
    contactName: "Drew Coastal",
    email: "drew@coastalpackaging.test",
    ackDelayDays: 1.1,
    onTimeRate: 0.88,
    changeRate: 0.08,
    quoteRate: 0.95,
    quoteDelayDays: 2,
    priceIndex: 1.12,
  },
];

type SeededSupplier = (typeof SUPPLIER_SEEDS)[number] & {
  id: string;
  contactId: string;
};

async function main() {
  // Idempotent: wipe prior demo data so this can be re-run freely in dev.
  // Order matters — it has to stay in step with src/lib/testing/wipe-test-db.ts,
  // which the Vitest suites share.
  await db.capturedEmail.deleteMany();
  await db.statusEvent.deleteMany();
  await db.actionItem.deleteMany();
  await db.rFQQuoteLine.deleteMany();
  await db.rFQQuote.deleteMany();
  await db.rFQSupplierInvite.deleteMany();
  await db.rFQLine.deleteMany();
  await db.rFQ.deleteMany();
  await db.pOLineChangeProposal.deleteMany();
  await db.purchaseOrderLine.deleteMany();
  await db.purchaseOrder.deleteMany();
  await db.supplierContact.deleteMany();
  await db.priceBreak.deleteMany();
  await db.priceListItem.deleteMany();
  await db.priceList.deleteMany();
  await db.supplier.deleteMany();
  await db.internalUserLocation.deleteMany();
  await db.location.deleteMany();
  await db.internalUser.deleteMany();
  await db.tenant.deleteMany();

  const tenant = await db.tenant.create({ data: { name: "Acme Manufacturing (demo)" } });

  // Document numbers come out of the tenant's own sequence, exactly as they
  // do at runtime — so the seeded data is indistinguishable from data the app
  // produced, and the sequence is left in a consistent state afterwards.
  let nextNumber = 10001;
  function docNumber(prefix: "P" | "Q" | "L"): string {
    return `${prefix}-${nextNumber++}`;
  }

  const passwordHash = await bcrypt.hash("zenosource-dev", 10);
  const owner = await db.internalUser.create({
    data: {
      tenantId: tenant.id,
      email: "buyer@acme.test",
      passwordHash,
      name: "Jordan Buyer",
      role: "OWNER",
    },
  });

  // MEMBER (non-owner) user, assigned to only one of the two locations, to
  // demonstrate location-based access — see docs/data-model.md#location.
  const member = await db.internalUser.create({
    data: {
      tenantId: tenant.id,
      email: "casey@acme.test",
      passwordHash,
      name: "Casey Buyer",
      role: "MEMBER",
    },
  });

  const chicago = await db.location.create({
    data: {
      tenantId: tenant.id,
      name: "Chicago Plant",
      code: "CHI-01",
      addressLine1: "4400 W Cermak Rd",
      city: "Chicago",
      region: "IL",
      postalCode: "60623",
      country: "US",
    },
  });

  const dallas = await db.location.create({
    data: {
      tenantId: tenant.id,
      name: "Dallas Warehouse",
      code: "DAL-01",
      addressLine1: "2100 S Lamar St",
      city: "Dallas",
      region: "TX",
      postalCode: "75215",
      country: "US",
    },
  });
  const locations = [chicago, dallas];

  await db.internalUserLocation.createMany({
    data: [
      { internalUserId: owner.id, locationId: chicago.id },
      { internalUserId: owner.id, locationId: dallas.id },
      { internalUserId: member.id, locationId: chicago.id },
    ],
  });

  // --- Suppliers ---
  const suppliers: SeededSupplier[] = [];
  for (const seed of SUPPLIER_SEEDS) {
    const supplier = await db.supplier.create({
      data: {
        tenantId: tenant.id,
        name: seed.name,
        primaryContactName: seed.contactName,
        primaryContactEmail: seed.email,
      },
    });
    const contact = await db.supplierContact.create({
      data: { supplierId: supplier.id, name: seed.contactName, email: seed.email },
    });
    suppliers.push({ ...seed, id: supplier.id, contactId: contact.id });
  }
  const [precisionParts, titanFasteners] = suppliers;

  // --- Price lists ---
  await db.priceList.create({
    data: {
      tenantId: tenant.id,
      number: docNumber("L"),
      supplierId: precisionParts.id,
      effectiveFrom: daysAgo(200),
      effectiveTo: utcDate(NOW, 165),
      items: {
        create: [
          {
            itemNumber: "SKU-1001",
            description: "M6 titanium bolt, 25mm",
            uom: "EA",
            priceBreaks: {
              create: [
                { minQuantity: 1, unitPrice: 0.95 },
                { minQuantity: 250, unitPrice: 0.85 },
                { minQuantity: 1000, unitPrice: 0.72 },
              ],
            },
          },
          {
            itemNumber: "SKU-2050",
            description: "Anodized aluminum bracket",
            uom: "EA",
            priceBreaks: {
              create: [
                { minQuantity: 1, unitPrice: 4.6 },
                { minQuantity: 100, unitPrice: 4.2 },
                { minQuantity: 500, unitPrice: 3.75 },
              ],
            },
          },
        ],
      },
    },
  });

  await db.priceList.create({
    data: {
      tenantId: tenant.id,
      number: docNumber("L"),
      supplierId: titanFasteners.id,
      effectiveFrom: daysAgo(120),
      items: {
        create: [
          {
            itemNumber: "SKU-3100",
            description: "Stainless steel hex nut",
            uom: "EA",
            priceBreaks: {
              create: [
                { minQuantity: 1, unitPrice: 0.4 },
                { minQuantity: 500, unitPrice: 0.32 },
                { minQuantity: 2000, unitPrice: 0.27 },
              ],
            },
          },
        ],
      },
    },
  });

  // Helper: one status-transition event plus its denormalized timestamp, the
  // same pairing recordStatusChange() enforces at runtime.
  async function event(params: {
    subjectType: StatusEventSubjectType;
    subjectId: string;
    fromStatus: string | null;
    toStatus: string;
    at: Date;
    actorLabel: string;
    actorUserId?: string;
    actorContactId?: string;
    note?: string;
  }) {
    await db.statusEvent.create({
      data: {
        tenantId: tenant.id,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        fromStatus: params.fromStatus,
        toStatus: params.toStatus,
        actorType: params.actorUserId
          ? "INTERNAL_USER"
          : params.actorContactId
            ? "EXTERNAL_USER"
            : "SYSTEM",
        actorUserId: params.actorUserId ?? null,
        actorContactId: params.actorContactId ?? null,
        actorLabel: params.actorLabel,
        note: params.note ?? null,
        occurredAt: params.at,
      },
    });
  }

  // --- The three fixed demo scenarios -------------------------------------
  // po1/po2/po3 are what the dashboard, action-view and race-condition tests
  // are written against — kept stable rather than folded into the generated
  // volume below.

  const po1Issued = daysAgo(6);
  const po1 = await db.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      number: docNumber("P"),
      supplierId: precisionParts.id,
      status: "ISSUED",
      totalValue: 500 * 0.85,
      createdAt: daysAgo(7),
      issuedAt: po1Issued,
      lines: {
        create: [
          {
            lineNumber: 1,
            itemNumber: "SKU-1001",
            description: "M6 titanium bolt, 25mm",
            uom: "EA",
            quantity: 500,
            unitPrice: 0.85,
            locationId: chicago.id,
            needByDate: utcDate(NOW, 12),
            status: "PENDING_ACKNOWLEDGMENT",
          },
        ],
      },
    },
  });
  await event({
    subjectType: "PURCHASE_ORDER",
    subjectId: po1.id,
    fromStatus: null,
    toStatus: "DRAFT",
    at: daysAgo(7),
    actorLabel: owner.name,
    actorUserId: owner.id,
  });
  await event({
    subjectType: "PURCHASE_ORDER",
    subjectId: po1.id,
    fromStatus: "DRAFT",
    toStatus: "ISSUED",
    at: po1Issued,
    actorLabel: owner.name,
    actorUserId: owner.id,
    note: `Sent to ${precisionParts.contactName}`,
  });

  const externalActionItem = await db.actionItem.create({
    data: {
      tenantId: tenant.id,
      subjectType: "PURCHASE_ORDER",
      subjectId: po1.id,
      actionType: "PO_ACKNOWLEDGE",
      ownerType: "EXTERNAL_USER",
      externalOwnerId: precisionParts.contactId,
      accessToken: accessToken(),
      openedAt: po1Issued,
      lastRemindedAt: daysAgo(2),
      reminderCount: 3,
    },
  });

  // Acknowledged PO where the supplier has proposed a change -> internal
  // action item. Delivers to Dallas — Casey (Chicago-only) should NOT see
  // this one; only Jordan (OWNER, assigned to both) can.
  const po2Proposed = daysAgo(3);
  const po2 = await db.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      number: docNumber("P"),
      supplierId: precisionParts.id,
      status: "ACKNOWLEDGED",
      totalValue: 200 * 4.2,
      createdAt: daysAgo(11),
      issuedAt: daysAgo(10),
      acknowledgedAt: daysAgo(9),
      lines: {
        create: [
          {
            lineNumber: 1,
            itemNumber: "SKU-2050",
            description: "Anodized aluminum bracket",
            uom: "EA",
            quantity: 200,
            unitPrice: 4.2,
            locationId: dallas.id,
            needByDate: utcDate(NOW, 7),
            status: "CHANGE_PROPOSED",
            proposedQuantity: 200,
            proposedUnitPrice: 4.6,
            proposedDate: utcDate(NOW, 21),
            proposedBySupplierContact: precisionParts.contactName,
            proposedAt: po2Proposed,
          },
        ],
      },
    },
    include: { lines: true },
  });

  await db.pOLineChangeProposal.create({
    data: {
      purchaseOrderLineId: po2.lines[0].id,
      previousQuantity: 200,
      previousUnitPrice: 4.2,
      previousDate: utcDate(NOW, 7),
      proposedQuantity: 200,
      proposedUnitPrice: 4.6,
      proposedDate: utcDate(NOW, 21),
      proposedByContactId: precisionParts.contactId,
      proposedByName: precisionParts.contactName,
      proposedAt: po2Proposed,
    },
  });

  await db.actionItem.create({
    data: {
      tenantId: tenant.id,
      subjectType: "PURCHASE_ORDER_LINE",
      subjectId: po2.lines[0].id,
      actionType: "PO_REVIEW_CHANGE_PROPOSAL",
      ownerType: "INTERNAL_USER",
      internalOwnerId: owner.id,
      accessToken: accessToken(),
      openedAt: po2Proposed,
    },
  });

  // Rejected PO -> internal action item for the buyer to review.
  const po3Rejected = daysAgo(19);
  const po3 = await db.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      number: docNumber("P"),
      supplierId: titanFasteners.id,
      status: "REJECTED",
      totalValue: 5000 * 0.32,
      createdAt: daysAgo(22),
      issuedAt: daysAgo(21),
      rejectedAt: po3Rejected,
      rejectionReason: "Can't meet this lead time at this quantity.",
      lines: {
        create: [
          {
            lineNumber: 1,
            itemNumber: "SKU-3100",
            description: "Stainless steel hex nut",
            uom: "EA",
            quantity: 5000,
            unitPrice: 0.32,
            locationId: chicago.id,
            needByDate: utcDate(NOW, 4),
            status: "PENDING_ACKNOWLEDGMENT",
          },
        ],
      },
    },
  });
  await event({
    subjectType: "PURCHASE_ORDER",
    subjectId: po3.id,
    fromStatus: "ISSUED",
    toStatus: "REJECTED",
    at: po3Rejected,
    actorLabel: titanFasteners.contactName,
    actorContactId: titanFasteners.contactId,
    note: "Can't meet this lead time at this quantity.",
  });

  // Deliberately old and owned by the member, so the age ramp has something
  // at its hot end on first login and Casey's board isn't empty.
  await db.actionItem.create({
    data: {
      tenantId: tenant.id,
      subjectType: "PURCHASE_ORDER",
      subjectId: po3.id,
      actionType: "PO_REVIEW_REJECTION",
      ownerType: "INTERNAL_USER",
      internalOwnerId: member.id,
      accessToken: accessToken(),
      openedAt: po3Rejected,
    },
  });

  // --- Volume: ~six months of history -------------------------------------
  //
  // Roughly 70% terminal / 20% mid-flight / 10% draft-or-cancelled, with
  // timestamps set explicitly (`@default(now())` only applies when omitted).
  // Line statuses agree with their header — the previous seed shipped CLOSED
  // orders carrying ACKNOWLEDGED lines, which made every rollup wrong.

  const random = makeRandom(20260729);
  const VOLUME = 130;
  let resolvedItemCount = 0;

  for (let i = 0; i < VOLUME; i++) {
    const supplier = suppliers[i % suppliers.length];
    const location = locations[i % locations.length];
    const createdDaysAgo = Math.round(6 + random() * 174);
    const createdAt = daysAgo(createdDaysAgo, 8 + (i % 8));
    const roll = random();

    // Terminal, mid-flight, or not yet out — weighted the way a real book is.
    const lifecycle: "closed" | "received" | "inflight" | "issued" | "draft" | "cancelled" =
      roll < 0.55
        ? "closed"
        : roll < 0.68
          ? "received"
          : roll < 0.8
            ? "inflight"
            : roll < 0.9
              ? "issued"
              : roll < 0.96
                ? "draft"
                : "cancelled";

    const lineCount = 1 + Math.floor(random() * 4);
    const lines = Array.from({ length: lineCount }, (_, j) => {
      const item = SAMPLE_ITEMS[(i + j) % SAMPLE_ITEMS.length];
      const quantity = Math.round((25 + random() * 900) / 5) * 5;
      return {
        item,
        quantity,
        unitPrice: Number((item.unitPrice * supplier.priceIndex).toFixed(4)),
        needByDate: utcDate(createdAt, 14 + Math.floor(random() * 30)),
      };
    });
    const totalValue = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

    const issuedAt = lifecycle === "draft" ? null : new Date(createdAt.getTime() + 0.5 * DAY);
    const acknowledgedAt =
      issuedAt && lifecycle !== "issued" && lifecycle !== "cancelled"
        ? new Date(issuedAt.getTime() + supplier.ackDelayDays * DAY)
        : null;
    const fulfilledAt =
      acknowledgedAt && (lifecycle === "closed" || lifecycle === "received")
        ? new Date(acknowledgedAt.getTime() + (10 + random() * 25) * DAY)
        : null;
    const closedAt =
      fulfilledAt && lifecycle === "closed"
        ? new Date(fulfilledAt.getTime() + (1 + random() * 6) * DAY)
        : null;

    const headerStatus: PurchaseOrderStatus =
      lifecycle === "closed"
        ? "CLOSED"
        : lifecycle === "received"
          ? "FULFILLED"
          : lifecycle === "inflight"
            ? "IN_PROGRESS"
            : lifecycle === "issued"
              ? "ISSUED"
              : lifecycle === "draft"
                ? "DRAFT"
                : "CANCELLED";

    const lineStatus: PurchaseOrderLineStatus =
      lifecycle === "closed"
        ? "CLOSED"
        : lifecycle === "received"
          ? "FULFILLED"
          : lifecycle === "inflight"
            ? "PARTIALLY_RECEIVED"
            : lifecycle === "issued"
              ? "PENDING_ACKNOWLEDGMENT"
              : lifecycle === "draft"
                ? "PENDING_ACKNOWLEDGMENT"
                : "CANCELLED";

    const po = await db.purchaseOrder.create({
      data: {
        tenantId: tenant.id,
        number: docNumber("P"),
        supplierId: supplier.id,
        status: headerStatus,
        totalValue,
        createdAt,
        updatedAt: closedAt ?? fulfilledAt ?? acknowledgedAt ?? issuedAt ?? createdAt,
        issuedAt,
        acknowledgedAt,
        fulfilledAt,
        closedAt,
        ...(lifecycle === "cancelled"
          ? {
              cancelledAt: new Date(createdAt.getTime() + 2 * DAY),
              cancelledByUserId: owner.id,
              cancellationReason: "Requirement withdrawn by production.",
            }
          : {}),
        lines: {
          create: lines.map((l, j) => {
            // On-time performance per the supplier's persona, so the
            // scorecard actually separates them.
            const onTime = random() < supplier.onTimeRate;
            const receivedAt = fulfilledAt
              ? new Date(l.needByDate.getTime() + (onTime ? -1 : 4 + random() * 12) * DAY)
              : lifecycle === "inflight" && j === 0
                ? new Date(createdAt.getTime() + 12 * DAY)
                : null;
            return {
              lineNumber: j + 1,
              itemNumber: l.item.itemNumber,
              description: l.item.description,
              uom: l.item.uom,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              locationId: location.id,
              needByDate: l.needByDate,
              promiseDate: acknowledgedAt ? l.needByDate : null,
              status:
                lifecycle === "inflight" && j > 0 ? ("ACKNOWLEDGED" as const) : lineStatus,
              receivedAt,
              receivedQuantity: receivedAt ? l.quantity : null,
              createdAt,
            };
          }),
        },
      },
      include: { lines: true },
    });

    // Transition history, so the scorecards and the possession strip have
    // something real to read.
    await event({
      subjectType: "PURCHASE_ORDER",
      subjectId: po.id,
      fromStatus: null,
      toStatus: "DRAFT",
      at: createdAt,
      actorLabel: i % 3 === 0 ? member.name : owner.name,
      actorUserId: i % 3 === 0 ? member.id : owner.id,
    });
    if (issuedAt) {
      await event({
        subjectType: "PURCHASE_ORDER",
        subjectId: po.id,
        fromStatus: "DRAFT",
        toStatus: "ISSUED",
        at: issuedAt,
        actorLabel: i % 3 === 0 ? member.name : owner.name,
        actorUserId: i % 3 === 0 ? member.id : owner.id,
      });
    }
    if (acknowledgedAt) {
      await event({
        subjectType: "PURCHASE_ORDER",
        subjectId: po.id,
        fromStatus: "ISSUED",
        toStatus: "ACKNOWLEDGED",
        at: acknowledgedAt,
        actorLabel: supplier.contactName,
        actorContactId: supplier.contactId,
      });
    }
    if (fulfilledAt) {
      await event({
        subjectType: "PURCHASE_ORDER",
        subjectId: po.id,
        fromStatus: "ACKNOWLEDGED",
        toStatus: "FULFILLED",
        at: fulfilledAt,
        actorLabel: owner.name,
        actorUserId: owner.id,
      });
    }
    if (closedAt) {
      await event({
        subjectType: "PURCHASE_ORDER",
        subjectId: po.id,
        fromStatus: "FULFILLED",
        toStatus: "CLOSED",
        at: closedAt,
        actorLabel: owner.name,
        actorUserId: owner.id,
      });
    }

    // Change proposals, at the persona's rate — the history the supplier
    // scorecard's change-rate and date-slip columns are computed from.
    if (acknowledgedAt && random() < supplier.changeRate) {
      const line = po.lines[0];
      const slip = 3 + Math.floor(random() * 18);
      await db.pOLineChangeProposal.create({
        data: {
          purchaseOrderLineId: line.id,
          previousQuantity: line.quantity,
          previousUnitPrice: line.unitPrice,
          previousDate: line.needByDate,
          proposedQuantity: line.quantity,
          proposedUnitPrice: Number((Number(line.unitPrice) * 1.06).toFixed(4)),
          proposedDate: line.needByDate ? new Date(line.needByDate.getTime() + slip * DAY) : null,
          proposedByContactId: supplier.contactId,
          proposedByName: supplier.contactName,
          proposedAt: acknowledgedAt,
          outcome: random() < 0.7 ? "ACCEPTED" : "REJECTED",
          decidedAt: new Date(acknowledgedAt.getTime() + 1.5 * DAY),
          decidedByUserId: owner.id,
        },
      });
    }

    // Resolved action items, with realistic open→resolved gaps and a chase
    // count — the raw material for "answered without a second chase".
    if (issuedAt && acknowledgedAt) {
      const chases = supplier.ackDelayDays > 3 ? 1 + Math.floor(random() * 3) : random() < 0.25 ? 1 : 0;
      await db.actionItem.create({
        data: {
          tenantId: tenant.id,
          subjectType: "PURCHASE_ORDER",
          subjectId: po.id,
          actionType: "PO_ACKNOWLEDGE",
          ownerType: "EXTERNAL_USER",
          externalOwnerId: supplier.contactId,
          accessToken: accessToken(),
          status: "RESOLVED",
          openedAt: issuedAt,
          resolvedAt: acknowledgedAt,
          resolvedByContactId: supplier.contactId,
          reminderCount: chases,
          lastRemindedAt: chases > 0 ? new Date(issuedAt.getTime() + DAY) : null,
        },
      });
      resolvedItemCount++;
    }
    if (closedAt) {
      await db.actionItem.create({
        data: {
          tenantId: tenant.id,
          subjectType: "PURCHASE_ORDER",
          subjectId: po.id,
          actionType: "PO_CLOSE",
          ownerType: "INTERNAL_USER",
          internalOwnerId: i % 3 === 0 ? member.id : owner.id,
          accessToken: accessToken(),
          status: "RESOLVED",
          openedAt: fulfilledAt!,
          resolvedAt: closedAt,
          resolvedByInternalUserId: i % 3 === 0 ? member.id : owner.id,
        },
      });
      resolvedItemCount++;
    }

    // Whatever is still in flight is still owed by somebody. Anything else
    // would be the modeling bug the product exists to prevent, seeded in.
    if (lifecycle === "issued") {
      await db.actionItem.create({
        data: {
          tenantId: tenant.id,
          subjectType: "PURCHASE_ORDER",
          subjectId: po.id,
          actionType: "PO_ACKNOWLEDGE",
          ownerType: "EXTERNAL_USER",
          externalOwnerId: supplier.contactId,
          accessToken: accessToken(),
          openedAt: issuedAt!,
          reminderCount: Math.floor(random() * 4),
          lastRemindedAt: random() < 0.5 ? daysAgo(1 + Math.floor(random() * 5)) : null,
        },
      });
    } else if (lifecycle === "inflight") {
      await db.actionItem.create({
        data: {
          tenantId: tenant.id,
          subjectType: "PURCHASE_ORDER",
          subjectId: po.id,
          actionType: "PO_DELIVER",
          ownerType: "EXTERNAL_USER",
          externalOwnerId: supplier.contactId,
          accessToken: accessToken(),
          openedAt: acknowledgedAt!,
          reminderCount: Math.floor(random() * 3),
        },
      });
    } else if (lifecycle === "received") {
      await db.actionItem.create({
        data: {
          tenantId: tenant.id,
          subjectType: "PURCHASE_ORDER",
          subjectId: po.id,
          actionType: "PO_CLOSE",
          ownerType: "INTERNAL_USER",
          internalOwnerId: i % 3 === 0 ? member.id : owner.id,
          accessToken: accessToken(),
          openedAt: fulfilledAt!,
        },
      });
    } else if (lifecycle === "draft") {
      await db.actionItem.create({
        data: {
          tenantId: tenant.id,
          subjectType: "PURCHASE_ORDER",
          subjectId: po.id,
          actionType: "PO_ISSUE_DRAFT",
          ownerType: "INTERNAL_USER",
          internalOwnerId: i % 3 === 0 ? member.id : owner.id,
          accessToken: accessToken(),
          openedAt: createdAt,
        },
      });
    }
  }

  // --- RFQs ---------------------------------------------------------------
  // 14 requests including awarded ones with staggered quotes and declines, so
  // the comparison surface and the RFQ half of the scorecard have data.

  let awardDemoRfqId: string | null = null;
  const RFQ_COUNT = 14;

  for (let i = 0; i < RFQ_COUNT; i++) {
    const createdDaysAgo = Math.round(3 + random() * 120);
    const createdAt = daysAgo(createdDaysAgo, 10);
    const roll = random();
    const status =
      roll < 0.1 ? "DRAFT" : roll < 0.3 ? "SENT" : roll < 0.55 ? "RESPONSES_OPEN" : roll < 0.85 ? "AWARDED" : "CLOSED";
    const sentAt = status === "DRAFT" ? null : new Date(createdAt.getTime() + 0.25 * DAY);

    const lineCount = 1 + Math.floor(random() * 3);
    const rfqLines = Array.from({ length: lineCount }, (_, j) => {
      const item = SAMPLE_ITEMS[(i + j) % SAMPLE_ITEMS.length];
      return {
        itemNumber: item.itemNumber,
        description: item.description,
        uom: item.uom,
        quantity: Math.round((100 + random() * 900) / 50) * 50,
        locationId: locations[i % locations.length].id,
        needByDate: utcDate(createdAt, 30 + Math.floor(random() * 30)),
        createdAt,
      };
    });

    const inviteCount = 2 + Math.floor(random() * 3);
    const invited = suppliers.slice(0, inviteCount);

    const rfq = await db.rFQ.create({
      data: {
        tenantId: tenant.id,
        number: docNumber("Q"),
        status,
        createdAt,
        updatedAt: sentAt ?? createdAt,
        sentAt,
        quoteDeadline: sentAt ? utcDate(sentAt, 14) : null,
        lines: { create: rfqLines },
        ...(sentAt
          ? {
              invites: {
                create: invited.map((s) => ({
                  supplierId: s.id,
                  status: "INVITED" as const,
                  createdAt,
                })),
              },
            }
          : {}),
      },
      include: { lines: true, invites: true },
    });

    await event({
      subjectType: "RFQ",
      subjectId: rfq.id,
      fromStatus: null,
      toStatus: "DRAFT",
      at: createdAt,
      actorLabel: owner.name,
      actorUserId: owner.id,
    });

    if (!sentAt) {
      await db.actionItem.create({
        data: {
          tenantId: tenant.id,
          subjectType: "RFQ",
          subjectId: rfq.id,
          actionType: "RFQ_SEND_DRAFT",
          ownerType: "INTERNAL_USER",
          internalOwnerId: owner.id,
          accessToken: accessToken(),
          openedAt: createdAt,
        },
      });
      continue;
    }

    await event({
      subjectType: "RFQ",
      subjectId: rfq.id,
      fromStatus: "DRAFT",
      toStatus: "SENT",
      at: sentAt,
      actorLabel: owner.name,
      actorUserId: owner.id,
      note: `Sent to ${invited.map((s) => s.name).join(", ")}`,
    });

    let firstQuoteId: string | null = null;
    let bestQuoteId: string | null = null;
    let bestTotal = Infinity;

    for (const supplier of invited) {
      const responds = status !== "SENT" && random() < supplier.quoteRate;
      const declines = !responds && random() < 0.35;
      const respondedAt = new Date(sentAt.getTime() + supplier.quoteDelayDays * DAY);

      if (declines) {
        await db.rFQSupplierInvite.updateMany({
          where: { rfqId: rfq.id, supplierId: supplier.id },
          data: { status: "DECLINED", declinedAt: respondedAt },
        });
        await db.actionItem.create({
          data: {
            tenantId: tenant.id,
            subjectType: "RFQ",
            subjectId: rfq.id,
            actionType: "RFQ_SUBMIT_QUOTE",
            ownerType: "EXTERNAL_USER",
            externalOwnerId: supplier.contactId,
            accessToken: accessToken(),
            status: "RESOLVED",
            openedAt: sentAt,
            resolvedAt: respondedAt,
            resolvedByContactId: supplier.contactId,
          },
        });
        resolvedItemCount++;
        continue;
      }

      if (!responds) {
        // Still owed — an unanswered invitation is exactly what the chase is
        // for, and every one of these lights up the RFQ list's invitee dots.
        await db.actionItem.create({
          data: {
            tenantId: tenant.id,
            subjectType: "RFQ",
            subjectId: rfq.id,
            actionType: "RFQ_SUBMIT_QUOTE",
            ownerType: "EXTERNAL_USER",
            externalOwnerId: supplier.contactId,
            accessToken: accessToken(),
            openedAt: sentAt,
            reminderCount: Math.floor(random() * 3),
          },
        });
        continue;
      }

      // A quote, sometimes partial — the award screen has to be able to tell
      // "didn't bid" from "bid nothing".
      const coversAll = random() < 0.8;
      const covered = coversAll ? rfq.lines : rfq.lines.slice(0, Math.max(1, rfq.lines.length - 1));
      const quote = await db.rFQQuote.create({
        data: {
          rfqId: rfq.id,
          supplierId: supplier.id,
          status: "SUBMITTED",
          submittedAt: respondedAt,
          createdAt: respondedAt,
          lines: {
            create: covered.map((line) => {
              const base =
                SAMPLE_ITEMS.find((s) => s.itemNumber === line.itemNumber)?.unitPrice ?? 1;
              return {
                rfqLineId: line.id,
                unitPrice: Number((base * supplier.priceIndex * (0.94 + random() * 0.12)).toFixed(4)),
                leadTimeDays: 7 + Math.floor(random() * 35),
                notes: random() < 0.2 ? "Tooling charge applies on first run." : null,
              };
            }),
          },
        },
        include: { lines: true },
      });

      await db.rFQSupplierInvite.updateMany({
        where: { rfqId: rfq.id, supplierId: supplier.id },
        data: { status: "RESPONDED", respondedAt },
      });
      await db.actionItem.create({
        data: {
          tenantId: tenant.id,
          subjectType: "RFQ",
          subjectId: rfq.id,
          actionType: "RFQ_SUBMIT_QUOTE",
          ownerType: "EXTERNAL_USER",
          externalOwnerId: supplier.contactId,
          accessToken: accessToken(),
          status: "RESOLVED",
          openedAt: sentAt,
          resolvedAt: respondedAt,
          resolvedByContactId: supplier.contactId,
          reminderCount: supplier.quoteDelayDays > 5 ? 2 : 0,
        },
      });
      resolvedItemCount++;

      firstQuoteId ??= quote.id;
      if (coversAll) {
        const total = quote.lines.reduce((sum, ql) => {
          const line = rfq.lines.find((l) => l.id === ql.rfqLineId)!;
          return sum + Number(line.quantity) * Number(ql.unitPrice);
        }, 0);
        if (total < bestTotal) {
          bestTotal = total;
          bestQuoteId = quote.id;
        }
      }
    }

    if (status === "RESPONSES_OPEN" && firstQuoteId) {
      if (!awardDemoRfqId) awardDemoRfqId = rfq.id;
      await db.rFQ.update({ where: { id: rfq.id }, data: { status: "RESPONSES_OPEN" } });
      await db.actionItem.create({
        data: {
          tenantId: tenant.id,
          subjectType: "RFQ",
          subjectId: rfq.id,
          actionType: "RFQ_AWARD_DECISION",
          ownerType: "INTERNAL_USER",
          internalOwnerId: owner.id,
          accessToken: accessToken(),
          openedAt: sentAt,
        },
      });
    } else if (status === "AWARDED" && bestQuoteId) {
      const awardedAt = new Date(sentAt.getTime() + 16 * DAY);
      await db.rFQ.update({
        where: { id: rfq.id },
        data: { status: "AWARDED", awardedQuoteId: bestQuoteId, awardedAt },
      });
      await event({
        subjectType: "RFQ",
        subjectId: rfq.id,
        fromStatus: "RESPONSES_OPEN",
        toStatus: "AWARDED",
        at: awardedAt,
        actorLabel: owner.name,
        actorUserId: owner.id,
      });
      await db.actionItem.create({
        data: {
          tenantId: tenant.id,
          subjectType: "RFQ",
          subjectId: rfq.id,
          actionType: "RFQ_RAISE_PO_FROM_AWARD",
          ownerType: "INTERNAL_USER",
          internalOwnerId: owner.id,
          accessToken: accessToken(),
          openedAt: awardedAt,
        },
      });
    } else if (status === "CLOSED") {
      const closedAt = new Date(sentAt.getTime() + 20 * DAY);
      await db.rFQ.update({ where: { id: rfq.id }, data: { status: "CLOSED", closedAt } });
      await event({
        subjectType: "RFQ",
        subjectId: rfq.id,
        fromStatus: "RESPONSES_OPEN",
        toStatus: "CLOSED",
        at: closedAt,
        actorLabel: owner.name,
        actorUserId: owner.id,
      });
      await db.actionItem.updateMany({
        where: { subjectType: "RFQ", subjectId: rfq.id, status: "OPEN" },
        data: { status: "RESOLVED", resolvedAt: closedAt },
      });
    }
  }

  // Leave the tenant's sequence where the seeded documents finished, so the
  // first number the app allocates continues rather than colliding.
  await db.tenant.update({
    where: { id: tenant.id },
    data: { nextDocumentNumber: nextNumber },
  });

  const [poCount, rfqCount, priceListCount, supplierCount, openItems, eventCount] =
    await Promise.all([
      db.purchaseOrder.count({ where: { tenantId: tenant.id } }),
      db.rFQ.count({ where: { tenantId: tenant.id } }),
      db.priceList.count({ where: { tenantId: tenant.id } }),
      db.supplier.count({ where: { tenantId: tenant.id } }),
      db.actionItem.count({ where: { tenantId: tenant.id, status: "OPEN" } }),
      db.statusEvent.count({ where: { tenantId: tenant.id } }),
    ]);

  console.log("\nSeed complete.");
  console.log(
    `  ${supplierCount} suppliers, ${priceListCount} price lists, ${poCount} purchase orders, ${rfqCount} RFQs, 2 locations`
  );
  console.log(
    `  ${openItems} open action items, ${resolvedItemCount} resolved, ${eventCount} status events across ~6 months\n`
  );
  console.log("Internal login: http://localhost:3000/login");
  console.log("  OWNER (sees both locations):  buyer@acme.test / zenosource-dev");
  console.log("  MEMBER (Chicago only):        casey@acme.test / zenosource-dev");
  console.log(
    `\nExternal action view (no login): http://localhost:3000/a/${externalActionItem.accessToken}\n`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
