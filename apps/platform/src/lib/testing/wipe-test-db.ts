import type { PrismaClient } from "@/generated/prisma/client";

// Full-database wipe for tests that share the zenosource_test database
// across suites (every Vitest file, plus Playwright's global-setup). Mirrors
// prisma/seed.ts's deletion order exactly — every table any suite could have
// populated, in FK-safe order — so any test file can safely start from a
// clean slate regardless of what ran before it in the same `vitest run`.
// Keep this in sync with prisma/seed.ts whenever a model is added; it's the
// one place that ordering needs to live now instead of copy-pasted per file.
export async function wipeTestDb(db: PrismaClient) {
  await db.capturedEmail.deleteMany();
  await db.statusEvent.deleteMany();
  await db.actionItem.deleteMany();
  // Ordered so every foreign key target is deleted later.
  await db.directoryEvent.deleteMany();
  await db.directoryGroupMember.deleteMany();
  await db.directoryGroupLocation.deleteMany();
  await db.directoryGroup.deleteMany();
  await db.directoryToken.deleteMany();
  await db.ssoAuthRequest.deleteMany();
  await db.tenantDomain.deleteMany();
  await db.integrationSyncRun.deleteMany();
  await db.integrationConnection.deleteMany();
  await db.pOSuggestion.deleteMany();
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
}
