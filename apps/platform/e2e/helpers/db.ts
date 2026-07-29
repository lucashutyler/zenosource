import { Client } from "pg";

// Raw pg instead of the generated Prisma client: Playwright's own TS
// transform doesn't handle the generated client's `import.meta.url` usage
// (tsx and Next's bundler both do — this is specific to Playwright's
// pipeline). Only a handful of simple lookups are needed here, so plain
// SQL is the path of least friction. Prisma quotes identifiers to
// preserve camelCase, so real column names need double-quoting too.
export async function withTestDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function findOpenActionItem(actionType: string) {
  return withTestDb(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM "ActionItem" WHERE "actionType" = $1 AND "status" = 'OPEN' LIMIT 1`,
      [actionType]
    );
    if (!rows[0]) throw new Error(`No OPEN ActionItem of type ${actionType} found`);
    return rows[0];
  });
}

export async function findActionItemById(id: string) {
  return withTestDb(async (client) => {
    const { rows } = await client.query(`SELECT * FROM "ActionItem" WHERE "id" = $1`, [id]);
    if (!rows[0]) throw new Error(`ActionItem ${id} not found`);
    return rows[0];
  });
}

export async function findLocationByCode(code: string) {
  return withTestDb(async (client) => {
    const { rows } = await client.query(`SELECT * FROM "Location" WHERE "code" = $1`, [code]);
    if (!rows[0]) throw new Error(`Location ${code} not found`);
    return rows[0];
  });
}

export async function findPurchaseOrderAtLocation(locationId: string) {
  return withTestDb(async (client) => {
    const { rows } = await client.query(
      `SELECT DISTINCT po.* FROM "PurchaseOrder" po
       JOIN "PurchaseOrderLine" line ON line."purchaseOrderId" = po."id"
       WHERE line."locationId" = $1 LIMIT 1`,
      [locationId]
    );
    if (!rows[0]) throw new Error(`No PurchaseOrder found at location ${locationId}`);
    return rows[0];
  });
}

export async function findPurchaseOrderLine(status: string) {
  return withTestDb(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM "PurchaseOrderLine" WHERE "status" = $1 LIMIT 1`,
      [status]
    );
    if (!rows[0]) throw new Error(`No PurchaseOrderLine with status ${status} found`);
    return rows[0];
  });
}

// Self-contained fixture: a fresh PO + line + OPEN PO_ACKNOWLEDGE action
// item, independent of the shared seed data. Tests that *resolve* an
// action item (there's only one PO_ACKNOWLEDGE item in the seed) need
// their own instance rather than racing other tests for the seeded one.
export async function createTestAcknowledgeItem() {
  return withTestDb(async (client) => {
    const { rows: tenantRows } = await client.query(`SELECT "id" FROM "Tenant" LIMIT 1`);
    const { rows: supplierRows } = await client.query(`SELECT "id" FROM "Supplier" LIMIT 1`);
    const { rows: contactRows } = await client.query(
      `SELECT "id", "email" FROM "SupplierContact" WHERE "supplierId" = $1 LIMIT 1`,
      [supplierRows[0].id]
    );
    const tenantId = tenantRows[0].id;
    const supplierId = supplierRows[0].id;
    const contactId = contactRows[0].id;
    const contactEmail = contactRows[0].email;

    const poId = `e2e${Math.random().toString(36).slice(2, 10)}`;
    await client.query(
      `INSERT INTO "PurchaseOrder" ("id", "tenantId", "supplierId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ISSUED', now(), now())`,
      [poId, tenantId, supplierId]
    );
    await client.query(
      `INSERT INTO "PurchaseOrderLine"
         ("id", "purchaseOrderId", "lineNumber", "itemNumber", "description", "uom", "quantity", "unitPrice", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 1, 'SKU-E2E-RACE', 'race test line', 'EA', 1, 1, 'PENDING_ACKNOWLEDGMENT', now(), now())`,
      [`${poId}-line`, poId]
    );
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const itemId = `${poId}-item`;
    await client.query(
      `INSERT INTO "ActionItem"
         ("id", "tenantId", "subjectType", "subjectId", "actionType", "ownerType", "externalOwnerId", "status", "accessToken", "openedAt")
       VALUES ($1, $2, 'PURCHASE_ORDER', $3, 'PO_ACKNOWLEDGE', 'EXTERNAL_USER', $4, 'OPEN', $5, now())`,
      [itemId, tenantId, poId, contactId, token]
    );

    return { id: itemId, subjectId: poId, accessToken: token, contactEmail };
  });
}

export async function findPurchaseOrderLineById(id: string) {
  return withTestDb(async (client) => {
    const { rows } = await client.query(`SELECT * FROM "PurchaseOrderLine" WHERE "id" = $1`, [id]);
    if (!rows[0]) throw new Error(`PurchaseOrderLine ${id} not found`);
    return rows[0];
  });
}

export async function findPurchaseOrderById(id: string) {
  return withTestDb(async (client) => {
    const { rows } = await client.query(`SELECT * FROM "PurchaseOrder" WHERE "id" = $1`, [id]);
    if (!rows[0]) throw new Error(`PurchaseOrder ${id} not found`);
    return rows[0];
  });
}

export async function findRFQAtLocation(locationId: string) {
  return withTestDb(async (client) => {
    const { rows } = await client.query(
      `SELECT DISTINCT rfq.* FROM "RFQ" rfq
       JOIN "RFQLine" line ON line."rfqId" = rfq."id"
       WHERE line."locationId" = $1 LIMIT 1`,
      [locationId]
    );
    if (!rows[0]) throw new Error(`No RFQ found at location ${locationId}`);
    return rows[0];
  });
}

// Self-contained fixture: a fresh ACKNOWLEDGED PO with one CHANGE_PROPOSED
// line and its OPEN PO_REVIEW_CHANGE_PROPOSAL action item, independent of
// the shared seed data (seed's own change-proposal scenario, po2, is
// already consumed by the "accepting a supplier-proposed change" spec).
export async function createTestChangeProposalItem() {
  return withTestDb(async (client) => {
    const { rows: tenantRows } = await client.query(`SELECT "id" FROM "Tenant" LIMIT 1`);
    const { rows: supplierRows } = await client.query(`SELECT "id", "name" FROM "Supplier" LIMIT 1`);
    const { rows: ownerRows } = await client.query(
      `SELECT "id" FROM "InternalUser" WHERE "role" = 'OWNER' LIMIT 1`
    );
    const tenantId = tenantRows[0].id;
    const supplierId = supplierRows[0].id;
    const supplierName = supplierRows[0].name;
    const ownerId = ownerRows[0].id;

    const poId = `e2e${Math.random().toString(36).slice(2, 10)}`;
    await client.query(
      `INSERT INTO "PurchaseOrder" ("id", "tenantId", "supplierId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACKNOWLEDGED', now(), now())`,
      [poId, tenantId, supplierId]
    );
    const lineId = `${poId}-line`;
    await client.query(
      `INSERT INTO "PurchaseOrderLine"
         ("id", "purchaseOrderId", "lineNumber", "itemNumber", "description", "uom", "quantity", "unitPrice",
          "status", "proposedQuantity", "proposedUnitPrice", "proposedBySupplierContact", "proposedAt",
          "createdAt", "updatedAt")
       VALUES ($1, $2, 1, 'SKU-E2E-PROPOSAL', 'change-proposal test line', 'EA', 1, 1,
               'CHANGE_PROPOSED', 2, 1.25, 'Test Contact', now(), now(), now())`,
      [lineId, poId]
    );
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const itemId = `${poId}-item`;
    await client.query(
      `INSERT INTO "ActionItem"
         ("id", "tenantId", "subjectType", "subjectId", "actionType", "ownerType", "internalOwnerId", "status", "accessToken", "openedAt")
       VALUES ($1, $2, 'PURCHASE_ORDER_LINE', $3, 'PO_REVIEW_CHANGE_PROPOSAL', 'INTERNAL_USER', $4, 'OPEN', $5, now())`,
      [itemId, tenantId, lineId, ownerId, token]
    );

    return { id: itemId, poId, lineId, supplierName };
  });
}

// Self-contained fixture: a fresh REJECTED PO with an OPEN
// PO_REVIEW_REJECTION item owned by the OWNER internal user — the
// PURCHASE_ORDER-subject, internally-owned scenario the PO list's "needs
// your action" dot is meant to light up for (distinct from
// createTestChangeProposalItem, whose item is line-subject, not PO-subject).
export async function createTestReviewRejectionItem() {
  return withTestDb(async (client) => {
    const { rows: tenantRows } = await client.query(`SELECT "id" FROM "Tenant" LIMIT 1`);
    const { rows: supplierRows } = await client.query(`SELECT "id" FROM "Supplier" LIMIT 1`);
    const { rows: ownerRows } = await client.query(
      `SELECT "id" FROM "InternalUser" WHERE "role" = 'OWNER' LIMIT 1`
    );
    const tenantId = tenantRows[0].id;
    const supplierId = supplierRows[0].id;
    const ownerId = ownerRows[0].id;

    const poId = `e2e${Math.random().toString(36).slice(2, 10)}`;
    await client.query(
      `INSERT INTO "PurchaseOrder" ("id", "tenantId", "supplierId", "status", "rejectedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'REJECTED', now(), now(), now())`,
      [poId, tenantId, supplierId]
    );
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const itemId = `${poId}-item`;
    await client.query(
      `INSERT INTO "ActionItem"
         ("id", "tenantId", "subjectType", "subjectId", "actionType", "ownerType", "internalOwnerId", "status", "accessToken", "openedAt")
       VALUES ($1, $2, 'PURCHASE_ORDER', $3, 'PO_REVIEW_REJECTION', 'INTERNAL_USER', $4, 'OPEN', $5, now())`,
      [itemId, tenantId, poId, ownerId, token]
    );

    return { id: itemId, poId };
  });
}

// Self-contained fixture: a fresh supplier with zero contacts, in the
// existing seeded tenant. Named distinctly per call so multiple specs can
// each create their own without colliding in the shared supplier-picker UI.
export async function createContactlessSupplier() {
  return withTestDb(async (client) => {
    const { rows: tenantRows } = await client.query(`SELECT "id" FROM "Tenant" LIMIT 1`);
    const tenantId = tenantRows[0].id;

    const supplierId = `e2e${Math.random().toString(36).slice(2, 10)}`;
    const name = `Contactless Supplier E2E ${Math.random().toString(36).slice(2, 8)}`;
    await client.query(
      `INSERT INTO "Supplier" ("id", "tenantId", "name", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now(), now())`,
      [supplierId, tenantId, name]
    );

    return { id: supplierId, name };
  });
}

export async function findOpenActionItemsForSubject(subjectType: string, subjectId: string) {
  return withTestDb(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM "ActionItem" WHERE "subjectType" = $1 AND "subjectId" = $2 AND "status" = 'OPEN'`,
      [subjectType, subjectId]
    );
    return rows;
  });
}

// Self-contained fixture: a fresh DRAFT PO with one line, for a fresh
// supplier that deliberately has zero contacts — the state issuePurchaseOrder
// must now refuse to issue into, rather than silently succeeding.
export async function createTestDraftPOForContactlessSupplier() {
  return withTestDb(async (client) => {
    const { rows: tenantRows } = await client.query(`SELECT "id" FROM "Tenant" LIMIT 1`);
    const { rows: locationRows } = await client.query(`SELECT "id" FROM "Location" LIMIT 1`);
    const tenantId = tenantRows[0].id;
    const locationId = locationRows[0].id;

    const supplier = await createContactlessSupplier();
    const supplierId = supplier.id;

    const poId = `e2e${Math.random().toString(36).slice(2, 10)}`;
    await client.query(
      `INSERT INTO "PurchaseOrder" ("id", "tenantId", "supplierId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'DRAFT', now(), now())`,
      [poId, tenantId, supplierId]
    );
    await client.query(
      `INSERT INTO "PurchaseOrderLine"
         ("id", "purchaseOrderId", "lineNumber", "itemNumber", "description", "uom", "quantity", "unitPrice",
          "locationId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 1, 'SKU-E2E-NOCONTACT', 'contactless supplier test line', 'EA', 1, 1,
               $3, 'PENDING_ACKNOWLEDGMENT', now(), now())`,
      [`${poId}-line`, poId, locationId]
    );

    return { poId, supplierId };
  });
}

// Self-contained fixture: a fresh SENT RFQ with an OPEN RFQ_AWARD_DECISION
// action item, independent of the shared seed data.
export async function createTestRfqAwardItem() {
  return withTestDb(async (client) => {
    const { rows: tenantRows } = await client.query(`SELECT "id" FROM "Tenant" LIMIT 1`);
    const { rows: ownerRows } = await client.query(
      `SELECT "id" FROM "InternalUser" WHERE "role" = 'OWNER' LIMIT 1`
    );
    const tenantId = tenantRows[0].id;
    const ownerId = ownerRows[0].id;

    const rfqId = `e2e${Math.random().toString(36).slice(2, 10)}`;
    await client.query(
      `INSERT INTO "RFQ" ("id", "tenantId", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, 'SENT', now(), now())`,
      [rfqId, tenantId]
    );
    await client.query(
      `INSERT INTO "RFQLine" ("id", "rfqId", "itemNumber", "description", "uom", "quantity", "createdAt", "updatedAt")
       VALUES ($1, $2, 'SKU-E2E-RFQ', 'award test line', 'EA', 1, now(), now())`,
      [`${rfqId}-line`, rfqId]
    );
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const itemId = `${rfqId}-item`;
    await client.query(
      `INSERT INTO "ActionItem"
         ("id", "tenantId", "subjectType", "subjectId", "actionType", "ownerType", "internalOwnerId", "status", "accessToken", "openedAt")
       VALUES ($1, $2, 'RFQ', $3, 'RFQ_AWARD_DECISION', 'INTERNAL_USER', $4, 'OPEN', $5, now())`,
      [itemId, tenantId, rfqId, ownerId, token]
    );

    return { id: itemId, rfqId };
  });
}
