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

async function main() {
  // Idempotent: wipe prior demo data so this can be re-run freely in dev.
  await db.actionItem.deleteMany();
  await db.purchaseOrderLine.deleteMany();
  await db.purchaseOrder.deleteMany();
  await db.supplierContact.deleteMany();
  await db.priceBreak.deleteMany();
  await db.priceListItem.deleteMany();
  await db.priceList.deleteMany();
  await db.supplier.deleteMany();
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

  const supplier = await db.supplier.create({
    data: {
      tenantId: tenant.id,
      name: "Precision Parts Co.",
      primaryContactName: "Sam Supplier",
      primaryContactEmail: "sam@precisionparts.test",
    },
  });

  const contact = await db.supplierContact.create({
    data: {
      supplierId: supplier.id,
      name: "Sam Supplier",
      email: "sam@precisionparts.test",
    },
  });

  // PO awaiting supplier acknowledgment -> external action item.
  const po1 = await db.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      supplierId: supplier.id,
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
      externalOwnerId: contact.id,
      accessToken: accessToken(),
    },
  });

  // Acknowledged PO where the supplier has proposed a change -> internal action item.
  const po2 = await db.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      supplierId: supplier.id,
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
            status: "CHANGE_PROPOSED",
            proposedQuantity: 200,
            proposedUnitPrice: 4.6,
            proposedDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            proposedBySupplierContact: contact.name,
            proposedAt: new Date(),
          },
        ],
      },
    },
  });

  await db.actionItem.create({
    data: {
      tenantId: tenant.id,
      subjectType: "PURCHASE_ORDER_LINE",
      subjectId: po2.id,
      actionType: "PO_REVIEW_CHANGE_PROPOSAL",
      ownerType: "INTERNAL_USER",
      internalOwnerId: owner.id,
      accessToken: accessToken(),
    },
  });

  console.log("\nSeed complete.\n");
  console.log("Internal login: http://localhost:3000/login");
  console.log("  email:    buyer@acme.test");
  console.log("  password: zenosource-dev");
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
