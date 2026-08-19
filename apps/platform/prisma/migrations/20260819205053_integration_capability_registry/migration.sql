-- Phase 2, step one: the persistent half of the capability model.
--
-- docs/architecture.md describes integrations declaring capabilities and
-- features requiring them, but until now there was no code for any of it —
-- deliberately, since "building it against zero integrations would be
-- speculative scaffolding, not tested infrastructure" (docs/todo.md Phase 2).
-- Epicor is that first real integration, so the registry lands with it.
--
-- The declarations stay in code (src/lib/integrations/registry.ts). What is
-- per-tenant lands here: whether a tenant connected an integration, what it
-- connected with, and whether that still works.
--
-- INTEGRATION_RECONNECT is not incidental. A DEGRADED connection withdraws
-- every capability it was feeding, which silently turns features off; a state
-- that turns off a feature and tells nobody is precisely the unowned state
-- docs/product.md calls a modeling bug, and src/lib/lifecycle.test.ts fails
-- the build over it. So a broken connection opens a real action item against
-- an OWNER and gets chased on the same clock as a late PO.

-- CreateEnum
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('CONNECTED', 'DEGRADED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "IntegrationHealthFailure" AS ENUM ('NONE', 'API_KEY', 'IDENTITY', 'UNREACHABLE', 'CONFIGURATION');

-- CreateEnum
CREATE TYPE "IntegrationSyncOutcome" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- AlterEnum
ALTER TYPE "ActionItemSubjectType" ADD VALUE 'INTEGRATION_CONNECTION';

-- AlterEnum
ALTER TYPE "ActionItemType" ADD VALUE 'INTEGRATION_RECONNECT';

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "config" JSONB,
    "secretsSealed" TEXT,
    "connectedAt" TIMESTAMP(3),
    "connectedByUserId" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastHealthyAt" TIMESTAMP(3),
    "healthFailure" "IntegrationHealthFailure" NOT NULL DEFAULT 'NONE',
    "healthDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSyncRun" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" "IntegrationSyncOutcome" NOT NULL DEFAULT 'RUNNING',
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "watermark" TIMESTAMP(3),

    CONSTRAINT "IntegrationSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationConnection_tenantId_idx" ON "IntegrationConnection"("tenantId");

-- CreateIndex
CREATE INDEX "IntegrationConnection_status_idx" ON "IntegrationConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_tenantId_integrationId_key" ON "IntegrationConnection"("tenantId", "integrationId");

-- CreateIndex
CREATE INDEX "IntegrationSyncRun_connectionId_resource_startedAt_idx" ON "IntegrationSyncRun"("connectionId", "resource", "startedAt");

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_connectedByUserId_fkey" FOREIGN KEY ("connectedByUserId") REFERENCES "InternalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSyncRun" ADD CONSTRAINT "IntegrationSyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
