-- Closes the `prisma db push` drift carried since Phase 1: `Location` (+
-- `InternalUserLocation`, + the `locationId` columns on PO/RFQ lines),
-- `RFQ.awardedQuoteId`, the `CapturedEmail` dev-mailbox table, and the
-- `SupplierContact.passwordHash` drop were all applied straight to the dev
-- and test databases without a migration file, so `prisma migrate deploy`
-- would have missed them. Generated with `prisma migrate diff
-- --from-migrations --to-schema`, i.e. it is exactly the delta between the
-- init migration and the schema as it already stood — running it against an
-- already-pushed database is a no-op in effect, not a change.

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "RFQ" ADD COLUMN     "awardedQuoteId" TEXT;

-- AlterTable
ALTER TABLE "RFQLine" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "SupplierContact" DROP COLUMN "passwordHash";

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sourceIntegrationId" TEXT,
    "externalRef" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "status" "LocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalUserLocation" (
    "id" TEXT NOT NULL,
    "internalUserId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalUserLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapturedEmail" (
    "id" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "textBody" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapturedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_tenantId_idx" ON "Location"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_tenantId_code_key" ON "Location"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InternalUserLocation_internalUserId_locationId_key" ON "InternalUserLocation"("internalUserId", "locationId");

-- CreateIndex
CREATE INDEX "CapturedEmail_createdAt_idx" ON "CapturedEmail"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RFQ_awardedQuoteId_key" ON "RFQ"("awardedQuoteId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalUserLocation" ADD CONSTRAINT "InternalUserLocation_internalUserId_fkey" FOREIGN KEY ("internalUserId") REFERENCES "InternalUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalUserLocation" ADD CONSTRAINT "InternalUserLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQ" ADD CONSTRAINT "RFQ_awardedQuoteId_fkey" FOREIGN KEY ("awardedQuoteId") REFERENCES "RFQQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQLine" ADD CONSTRAINT "RFQLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
