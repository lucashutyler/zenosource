-- Phase 1a reporting prerequisites + the Phase 1b document-number decision.
--
-- Three things land here that cannot be backfilled later, which is why they
-- go in before the surfaces that read them:
--   * StatusEvent — the append-only transition log docs/product.md says the
--     scorecards are "built on". Every metric about how *long* a state lasted
--     is unanswerable without it, and no amount of later code recovers the
--     history that wasn't written down.
--   * POLineChangeProposal — accept/reject currently nulls the live proposal
--     in place, destroying the outcome. Change-proposal rate and average date
--     slip are supplier-scorecard metrics.
--   * Lifecycle timestamps on PurchaseOrder / RFQ / RFQSupplierInvite.
--
-- Document numbers are backfilled rather than defaulted: `number` is
-- NOT NULL + unique per tenant, so the columns are added nullable, filled
-- from one interleaved per-tenant sequence (POs, RFQs and price lists share
-- one number space — see Tenant.nextDocumentNumber), and only then locked.

-- CreateEnum
CREATE TYPE "SupplierContactStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ChangeProposalOutcome" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "StatusEventSubjectType" AS ENUM ('PURCHASE_ORDER', 'PURCHASE_ORDER_LINE', 'RFQ');

-- CreateEnum
CREATE TYPE "StatusEventActorType" AS ENUM ('INTERNAL_USER', 'EXTERNAL_USER', 'SYSTEM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActionItemType" ADD VALUE 'PO_ISSUE_DRAFT';
ALTER TYPE "ActionItemType" ADD VALUE 'PO_DELIVER';
ALTER TYPE "ActionItemType" ADD VALUE 'PO_CLOSE';
ALTER TYPE "ActionItemType" ADD VALUE 'RFQ_SEND_DRAFT';
ALTER TYPE "ActionItemType" ADD VALUE 'RFQ_RAISE_PO_FROM_AWARD';

-- AlterEnum
ALTER TYPE "PurchaseOrderLineStatus" ADD VALUE 'PARTIALLY_RECEIVED';

-- AlterTable
ALTER TABLE "ActionItem" ADD COLUMN     "lastRemindedAt" TIMESTAMP(3),
ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resolvedByContactId" TEXT,
ADD COLUMN     "resolvedByInternalUserId" TEXT;

-- AlterTable
ALTER TABLE "PriceList" ADD COLUMN     "number" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "fulfilledAt" TIMESTAMP(3),
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "number" TEXT,
ADD COLUMN     "totalValue" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedQuantity" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "RFQ" ADD COLUMN     "awardedAt" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "number" TEXT,
ADD COLUMN     "quoteDeadline" TIMESTAMP(3),
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RFQSupplierInvite" ADD COLUMN     "declinedAt" TIMESTAMP(3),
ADD COLUMN     "respondedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SupplierContact" ADD COLUMN     "status" "SupplierContactStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "nextDocumentNumber" INTEGER NOT NULL DEFAULT 10001;

-- Backfill document numbers ------------------------------------------------
-- One sequence per tenant spanning all three document classes, ordered by
-- creation so the numbers read chronologically the way a paper book would.
WITH all_docs AS (
    SELECT "id", "tenantId", "createdAt", 'P' AS class, 'PO' AS src FROM "PurchaseOrder"
    UNION ALL
    SELECT "id", "tenantId", "createdAt", 'Q' AS class, 'RFQ' AS src FROM "RFQ"
    UNION ALL
    SELECT "id", "tenantId", "createdAt", 'L' AS class, 'PL' AS src FROM "PriceList"
), numbered AS (
    SELECT "id", src, class,
           10000 + row_number() OVER (PARTITION BY "tenantId" ORDER BY "createdAt", "id") AS n
    FROM all_docs
), upd_po AS (
    UPDATE "PurchaseOrder" t SET "number" = n.class || '-' || n.n::text
    FROM numbered n WHERE t."id" = n."id" AND n.src = 'PO' RETURNING 1
), upd_rfq AS (
    UPDATE "RFQ" t SET "number" = n.class || '-' || n.n::text
    FROM numbered n WHERE t."id" = n."id" AND n.src = 'RFQ' RETURNING 1
)
UPDATE "PriceList" t SET "number" = n.class || '-' || n.n::text
FROM numbered n WHERE t."id" = n."id" AND n.src = 'PL';

-- Advance each tenant's cursor past everything just handed out.
UPDATE "Tenant" t SET "nextDocumentNumber" = GREATEST(t."nextDocumentNumber", used.max_n + 1)
FROM (
    SELECT "tenantId", MAX(n) AS max_n FROM (
        SELECT "tenantId", split_part("number", '-', 2)::int AS n FROM "PurchaseOrder"
        UNION ALL
        SELECT "tenantId", split_part("number", '-', 2)::int FROM "RFQ"
        UNION ALL
        SELECT "tenantId", split_part("number", '-', 2)::int FROM "PriceList"
    ) s GROUP BY "tenantId"
) used
WHERE t."id" = used."tenantId";

ALTER TABLE "PurchaseOrder" ALTER COLUMN "number" SET NOT NULL;
ALTER TABLE "RFQ" ALTER COLUMN "number" SET NOT NULL;
ALTER TABLE "PriceList" ALTER COLUMN "number" SET NOT NULL;

-- Backfill order value from the lines already on file, so the value half of
-- "rank by dwell x value" works on day one rather than only for new orders.
UPDATE "PurchaseOrder" po SET "totalValue" = COALESCE(agg.total, 0)
FROM (
    SELECT "purchaseOrderId", SUM("quantity" * "unitPrice") AS total
    FROM "PurchaseOrderLine" GROUP BY "purchaseOrderId"
) agg
WHERE po."id" = agg."purchaseOrderId";

-- CreateTable
CREATE TABLE "POLineChangeProposal" (
    "id" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "previousQuantity" DECIMAL(14,4) NOT NULL,
    "previousUnitPrice" DECIMAL(14,4) NOT NULL,
    "previousDate" TIMESTAMP(3),
    "proposedQuantity" DECIMAL(14,4) NOT NULL,
    "proposedUnitPrice" DECIMAL(14,4) NOT NULL,
    "proposedDate" TIMESTAMP(3),
    "proposedByContactId" TEXT,
    "proposedByName" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "ChangeProposalOutcome" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decisionNote" TEXT,

    CONSTRAINT "POLineChangeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectType" "StatusEventSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorType" "StatusEventActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorContactId" TEXT,
    "actorLabel" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "POLineChangeProposal_purchaseOrderLineId_idx" ON "POLineChangeProposal"("purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "StatusEvent_tenantId_idx" ON "StatusEvent"("tenantId");

-- CreateIndex
CREATE INDEX "StatusEvent_subjectType_subjectId_occurredAt_idx" ON "StatusEvent"("subjectType", "subjectId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActionItem_tenantId_status_ownerType_idx" ON "ActionItem"("tenantId", "status", "ownerType");

-- CreateIndex
CREATE INDEX "ActionItem_subjectType_subjectId_status_idx" ON "ActionItem"("subjectType", "subjectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_tenantId_number_key" ON "PriceList"("tenantId", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_status_idx" ON "PurchaseOrder"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_number_key" ON "PurchaseOrder"("tenantId", "number");

-- CreateIndex
CREATE INDEX "RFQ_tenantId_status_idx" ON "RFQ"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RFQ_tenantId_number_key" ON "RFQ"("tenantId", "number");

-- AddForeignKey
ALTER TABLE "POLineChangeProposal" ADD CONSTRAINT "POLineChangeProposal_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POLineChangeProposal" ADD CONSTRAINT "POLineChangeProposal_proposedByContactId_fkey" FOREIGN KEY ("proposedByContactId") REFERENCES "SupplierContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_resolvedByInternalUserId_fkey" FOREIGN KEY ("resolvedByInternalUserId") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_resolvedByContactId_fkey" FOREIGN KEY ("resolvedByContactId") REFERENCES "SupplierContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusEvent" ADD CONSTRAINT "StatusEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
