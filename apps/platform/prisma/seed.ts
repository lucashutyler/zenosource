import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

function accessToken() {
  return randomBytes(32).toString("hex");
}

const SAMPLE_ITEMS = [
  { itemNumber: "SKU-1001", description: "M6 titanium bolt, 25mm", uom: "EA", unitPrice: 0.85 },
  { itemNumber: "SKU-2050", description: "Anodized aluminum bracket", uom: "EA", unitPrice: 4.2 },
  { itemNumber: "SKU-3100", description: "Stainless steel hex nut", uom: "EA", unitPrice: 0.32 },
  { itemNumber: "SKU-4200", description: "Carbon fiber panel, 12x12in", uom: "EA", unitPrice: 38.5 },
  { itemNumber: "SKU-5010", description: "Rubber gasket seal", uom: "EA", unitPrice: 1.15 },
  { itemNumber: "SKU-6300", description: "Copper wire spool, 100ft", uom: "SPOOL", unitPrice: 22.0 },
];

const PO_STATUS_CYCLE = [
  "DRAFT",
  "ISSUED",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "FULFILLED",
  "CLOSED",
  "CANCELLED",
] as const;

async function main() {
  // Idempotent: wipe prior demo data so this can be re-run freely in dev.
  await db.capturedEmail.deleteMany();
  await db.actionItem.deleteMany();
  await db.rFQQuoteLine.deleteMany();
  await db.rFQQuote.deleteMany();
  await db.rFQSupplierInvite.deleteMany();
  await db.rFQLine.deleteMany();
  await db.rFQ.deleteMany();
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

  const tenant = await db.tenant.create({
    data: { name: "Acme Manufacturing (demo)" },
  });

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
      city: "Chicago",
      region: "IL",
      country: "US",
    },
  });

  const dallas = await db.location.create({
    data: {
      tenantId: tenant.id,
      name: "Dallas Warehouse",
      code: "DAL-01",
      city: "Dallas",
      region: "TX",
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
  const supplierSeeds = [
    { name: "Precision Parts Co.", contactName: "Sam Supplier", email: "sam@precisionparts.test" },
    { name: "Titan Fasteners Inc.", contactName: "Riley Titan", email: "riley@titanfasteners.test" },
    { name: "Northline Metal Supply", contactName: "Jamie North", email: "jamie@northlinemetal.test" },
    { name: "Apex Electronics Components", contactName: "Morgan Apex", email: "morgan@apexelectronics.test" },
    { name: "Coastal Packaging Solutions", contactName: "Drew Coastal", email: "drew@coastalpackaging.test" },
  ];

  const suppliers = [];
  for (const s of supplierSeeds) {
    const supplier = await db.supplier.create({
      data: {
        tenantId: tenant.id,
        name: s.name,
        primaryContactName: s.contactName,
        primaryContactEmail: s.email,
      },
    });
    const contact = await db.supplierContact.create({
      data: { supplierId: supplier.id, name: s.contactName, email: s.email },
    });
    suppliers.push({ ...supplier, contact });
  }
  const [precisionParts, titanFasteners] = suppliers;

  // --- Price lists (a couple, on different suppliers) ---
  await db.priceList.create({
    data: {
      tenantId: tenant.id,
      supplierId: precisionParts.id,
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
        ],
      },
    },
  });

  await db.priceList.create({
    data: {
      tenantId: tenant.id,
      supplierId: titanFasteners.id,
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

  // --- Purchase orders ---
  // po1/po2/po3 are the fixed demo scenarios other features (dashboard,
  // action-view, race-condition tests) are written against — keep these
  // stable rather than folding them into the generated loop below.

  // PO awaiting supplier acknowledgment -> external action item.
  const po1 = await db.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      supplierId: precisionParts.id,
      status: "ISSUED",
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
            status: "PENDING_ACKNOWLEDGMENT",
          },
        ],
      },
    },
  });

  const externalActionItem = await db.actionItem.create({
    data: {
      tenantId: tenant.id,
      subjectType: "PURCHASE_ORDER",
      subjectId: po1.id,
      actionType: "PO_ACKNOWLEDGE",
      ownerType: "EXTERNAL_USER",
      externalOwnerId: precisionParts.contact.id,
      accessToken: accessToken(),
    },
  });

  // Acknowledged PO where the supplier has proposed a change -> internal
  // action item. Delivers to Dallas — Casey (Chicago-only) should NOT see
  // this one; only Jordan (OWNER, assigned to both) can.
  const po2 = await db.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      supplierId: precisionParts.id,
      status: "ACKNOWLEDGED",
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
            status: "CHANGE_PROPOSED",
            proposedQuantity: 200,
            proposedUnitPrice: 4.6,
            proposedDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            proposedBySupplierContact: precisionParts.contact.name,
            proposedAt: new Date(),
          },
        ],
      },
    },
    include: { lines: true },
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
    },
  });

  // Rejected PO -> internal action item for the buyer to review.
  const po3 = await db.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      supplierId: titanFasteners.id,
      status: "REJECTED",
      rejectedAt: new Date(),
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
            status: "PENDING_ACKNOWLEDGMENT",
          },
        ],
      },
    },
  });

  await db.actionItem.create({
    data: {
      tenantId: tenant.id,
      subjectType: "PURCHASE_ORDER",
      subjectId: po3.id,
      actionType: "PO_REVIEW_REJECTION",
      ownerType: "INTERNAL_USER",
      internalOwnerId: owner.id,
      accessToken: accessToken(),
    },
  });

  // ~21 more POs cycling through suppliers/locations/statuses/items, no
  // action items — just volume for list/filter/sort testing.
  const EXTRA_PO_COUNT = 21;
  for (let i = 0; i < EXTRA_PO_COUNT; i++) {
    const supplier = suppliers[i % suppliers.length];
    const location = locations[i % locations.length];
    const status = PO_STATUS_CYCLE[i % PO_STATUS_CYCLE.length];
    const lineCount = (i % 3) + 1;
    const lines = Array.from({ length: lineCount }, (_, j) => {
      const item = SAMPLE_ITEMS[(i + j) % SAMPLE_ITEMS.length];
      return {
        lineNumber: j + 1,
        itemNumber: item.itemNumber,
        description: item.description,
        uom: item.uom,
        quantity: 10 * (j + 1) * ((i % 5) + 1),
        unitPrice: item.unitPrice,
        locationId: location.id,
        status:
          status === "DRAFT"
            ? ("PENDING_ACKNOWLEDGMENT" as const)
            : status === "CANCELLED"
              ? ("CANCELLED" as const)
              : ("ACKNOWLEDGED" as const),
      };
    });

    await db.purchaseOrder.create({
      data: {
        tenantId: tenant.id,
        supplierId: supplier.id,
        status,
        ...(status === "CANCELLED"
          ? { cancelledAt: new Date(), cancelledByUserId: owner.id, cancellationReason: "No longer needed." }
          : {}),
        lines: { create: lines },
      },
    });
  }

  // --- RFQs ---
  const RFQ_STATUS_CYCLE = ["DRAFT", "SENT", "RESPONSES_OPEN", "CLOSED"] as const;
  let awardDemoRfqId: string | null = null;
  for (let i = 0; i < 5; i++) {
    const status = RFQ_STATUS_CYCLE[i % RFQ_STATUS_CYCLE.length];
    const item = SAMPLE_ITEMS[i % SAMPLE_ITEMS.length];
    const location = locations[i % locations.length];
    const rfq = await db.rFQ.create({
      data: {
        tenantId: tenant.id,
        status,
        lines: {
          create: [
            {
              itemNumber: item.itemNumber,
              description: item.description,
              uom: item.uom,
              quantity: 100 * (i + 1),
              locationId: location.id,
            },
          ],
        },
        ...(status !== "DRAFT"
          ? {
              invites: {
                create: [{ supplierId: suppliers[i % suppliers.length].id, status: "INVITED" }],
              },
            }
          : {}),
      },
    });
    if (status === "RESPONSES_OPEN" && !awardDemoRfqId) awardDemoRfqId = rfq.id;
  }

  // One RFQ demo action item, so the dashboard has an example of an
  // RFQ-typed item and the PO-detail-style linking generalizes to RFQs too.
  // The app doesn't generate RFQ_AWARD_DECISION items automatically yet —
  // RFQ CRUD doesn't wire up ActionItem creation (see docs/todo.md) — this
  // one's seeded by hand purely to exercise the link-resolution path.
  if (awardDemoRfqId) {
    await db.actionItem.create({
      data: {
        tenantId: tenant.id,
        subjectType: "RFQ",
        subjectId: awardDemoRfqId,
        actionType: "RFQ_AWARD_DECISION",
        ownerType: "INTERNAL_USER",
        internalOwnerId: owner.id,
        accessToken: accessToken(),
      },
    });
  }

  const [poCount, rfqCount, priceListCount, supplierCount] = await Promise.all([
    db.purchaseOrder.count({ where: { tenantId: tenant.id } }),
    db.rFQ.count({ where: { tenantId: tenant.id } }),
    db.priceList.count({ where: { tenantId: tenant.id } }),
    db.supplier.count({ where: { tenantId: tenant.id } }),
  ]);

  console.log("\nSeed complete.");
  console.log(
    `  ${supplierCount} suppliers, ${priceListCount} price lists, ${poCount} purchase orders, ${rfqCount} RFQs, 2 locations\n`
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
