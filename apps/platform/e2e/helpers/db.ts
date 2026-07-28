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
      `SELECT "id" FROM "SupplierContact" WHERE "supplierId" = $1 LIMIT 1`,
      [supplierRows[0].id]
    );
    const tenantId = tenantRows[0].id;
    const supplierId = supplierRows[0].id;
    const contactId = contactRows[0].id;

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

    return { id: itemId, subjectId: poId, accessToken: token };
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
