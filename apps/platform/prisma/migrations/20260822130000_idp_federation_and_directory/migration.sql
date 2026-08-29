-- Phase 3: federated sign-in and directory provisioning.
--
-- Two statements here cannot be generated, and both are the add-nullable /
-- backfill / constrain dance apps/platform/CLAUDE.md documents (worked example:
-- 20260729093000_reporting_history_and_document_numbers). Verify this against a
-- copy of a POPULATED database before committing — a backfill that works on an
-- empty schema proves very little:
--
--   docker compose exec -T db psql -U zenosource -d postgres \
--     -c "CREATE DATABASE zenosource_check TEMPLATE zenosource;"
--
--   * Tenant.slug is NOT NULL and globally unique on a table that already has
--     rows, so it arrives nullable, is derived from the tenant's name, is
--     de-duplicated, and only then constrained.
--   * InternalUser.status is NOT NULL but carries a DEFAULT, so Postgres fills
--     existing rows itself and one statement is enough.
--   * InternalUser.passwordHash only ever widens (NOT NULL dropped), which no
--     existing row can fail.

-- CreateEnum
CREATE TYPE "InternalUserStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "LocationAssignmentSource" AS ENUM ('MANUAL', 'DIRECTORY');

-- CreateEnum
CREATE TYPE "DirectoryEventKind" AS ENUM ('USER_CREATED', 'USER_UPDATED', 'USER_ADOPTED', 'USER_DEACTIVATED', 'USER_REACTIVATED', 'GROUP_CREATED', 'GROUP_UPDATED', 'GROUP_DELETED', 'GROUP_MEMBERSHIP_CHANGED', 'GRANTS_RECOMPUTED', 'OPERATION_REFUSED');

-- CreateEnum
CREATE TYPE "SsoProtocol" AS ENUM ('OIDC', 'SAML');

-- AlterTable
ALTER TABLE "InternalUser" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "sourceIntegrationId" TEXT,
ADD COLUMN     "status" "InternalUserStatus" NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InternalUserLocation" ADD COLUMN     "grantedByGroupId" TEXT,
ADD COLUMN     "source" "LocationAssignmentSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable: Tenant.slug arrives nullable so existing rows survive the add.
ALTER TABLE "Tenant" ADD COLUMN     "slug" TEXT;

-- Backfill: the tenant's own name, lowercased, with runs of anything that
-- isn't a letter or a digit collapsed to a single hyphen and the ends trimmed.
UPDATE "Tenant"
SET "slug" = NULLIF(trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), '');

-- A name that reduces to nothing at all still needs a slug.
UPDATE "Tenant" SET "slug" = 'tenant-' || substr("id", 1, 8) WHERE "slug" IS NULL;

-- Two tenants can legitimately be called the same thing. Oldest keeps the bare
-- slug; the rest are suffixed in creation order, so the result is stable rather
-- than dependent on scan order.
WITH ranked AS (
  SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "createdAt", "id") AS rn
  FROM "Tenant"
)
UPDATE "Tenant" t
SET "slug" = t."slug" || '-' || ranked.rn
FROM ranked
WHERE ranked."id" = t."id" AND ranked.rn > 1;

ALTER TABLE "Tenant" ALTER COLUMN "slug" SET NOT NULL;

-- CreateTable
CREATE TABLE "TenantDomain" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectoryToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DirectoryToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectoryGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "mappedRole" "InternalUserRole",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectoryGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectoryGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "internalUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectoryGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectoryGroupLocation" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "DirectoryGroupLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectoryEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT,
    "kind" "DirectoryEventKind" NOT NULL,
    "internalUserId" TEXT,
    "subjectHint" TEXT,
    "reason" TEXT,
    "detail" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoAuthRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "protocol" "SsoProtocol" NOT NULL,
    "handle" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "nonce" TEXT,
    "codeVerifier" TEXT,
    "browserBindingHash" TEXT NOT NULL,
    "redirectTo" TEXT NOT NULL DEFAULT '/dashboard',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "SsoAuthRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantDomain_tenantId_idx" ON "TenantDomain"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantDomain_domain_key" ON "TenantDomain"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "DirectoryToken_tokenHash_key" ON "DirectoryToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DirectoryToken_tenantId_idx" ON "DirectoryToken"("tenantId");

-- CreateIndex
CREATE INDEX "DirectoryToken_connectionId_idx" ON "DirectoryToken"("connectionId");

-- CreateIndex
CREATE INDEX "DirectoryGroup_tenantId_idx" ON "DirectoryGroup"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectoryGroup_connectionId_externalRef_key" ON "DirectoryGroup"("connectionId", "externalRef");

-- CreateIndex
CREATE INDEX "DirectoryGroupMember_internalUserId_idx" ON "DirectoryGroupMember"("internalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectoryGroupMember_groupId_internalUserId_key" ON "DirectoryGroupMember"("groupId", "internalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectoryGroupLocation_groupId_locationId_key" ON "DirectoryGroupLocation"("groupId", "locationId");

-- CreateIndex
CREATE INDEX "DirectoryEvent_tenantId_occurredAt_idx" ON "DirectoryEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SsoAuthRequest_handle_key" ON "SsoAuthRequest"("handle");

-- CreateIndex
CREATE INDEX "SsoAuthRequest_tenantId_idx" ON "SsoAuthRequest"("tenantId");

-- CreateIndex
CREATE INDEX "SsoAuthRequest_expiresAt_idx" ON "SsoAuthRequest"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "InternalUser_tenantId_sourceIntegrationId_externalRef_key" ON "InternalUser"("tenantId", "sourceIntegrationId", "externalRef");

-- CreateIndex
CREATE INDEX "InternalUserLocation_grantedByGroupId_idx" ON "InternalUserLocation"("grantedByGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- AddForeignKey
ALTER TABLE "InternalUserLocation" ADD CONSTRAINT "InternalUserLocation_grantedByGroupId_fkey" FOREIGN KEY ("grantedByGroupId") REFERENCES "DirectoryGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantDomain" ADD CONSTRAINT "TenantDomain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryToken" ADD CONSTRAINT "DirectoryToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryToken" ADD CONSTRAINT "DirectoryToken_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryToken" ADD CONSTRAINT "DirectoryToken_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryGroup" ADD CONSTRAINT "DirectoryGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryGroup" ADD CONSTRAINT "DirectoryGroup_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryGroupMember" ADD CONSTRAINT "DirectoryGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DirectoryGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryGroupMember" ADD CONSTRAINT "DirectoryGroupMember_internalUserId_fkey" FOREIGN KEY ("internalUserId") REFERENCES "InternalUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryGroupLocation" ADD CONSTRAINT "DirectoryGroupLocation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DirectoryGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryGroupLocation" ADD CONSTRAINT "DirectoryGroupLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryEvent" ADD CONSTRAINT "DirectoryEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryEvent" ADD CONSTRAINT "DirectoryEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryEvent" ADD CONSTRAINT "DirectoryEvent_internalUserId_fkey" FOREIGN KEY ("internalUserId") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoAuthRequest" ADD CONSTRAINT "SsoAuthRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
