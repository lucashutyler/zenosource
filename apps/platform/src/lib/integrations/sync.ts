import "server-only";
import { db } from "@/lib/db";
import { allocateDocumentNumber, DOCUMENT_CLASS } from "@/lib/document-number";
import { refreshPurchaseOrderTotal } from "@/lib/po-total";
import { createActionItem, resolveOpenActionItemsFor } from "@/lib/action-items";
import { pickInternalOwner } from "@/lib/access";
import type {
  CanonicalPOSuggestion,
  CanonicalPriceList,
  CanonicalPurchaseOrder,
  CanonicalSupplier,
  ErpConnector,
  SyncResource,
} from "./contract";
import { getConnector } from "./connectors";
import { getIntegration } from "./registry";
import { recordHealth, sessionFor } from "./connections";
import type { IntegrationConnection } from "@/generated/prisma/client";

// Turning canonical records into ZenoSource rows.
//
// The single rule everything here obeys: **the ERP owns the fields it owns,
// and we own the collaboration state layered on top**
// (docs/architecture.md#data-boundaries). A nightly sync that overwrote an
// acknowledgment would re-chase a supplier who already answered — the exact
// behaviour this product sells itself as preventing. Every upsert below is
// written to be re-runnable against the same data without moving anything
// backwards.

export type ResourceResult = {
  resource: SyncResource;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  error?: string;
};

export type SyncSummary = {
  connectionId: string;
  results: ResourceResult[];
  /** True when this was the connection's first sync — see the chase guard below. */
  backfill: boolean;
};

const RESOURCE_CAPABILITY: Record<SyncResource, string> = {
  suppliers: "supplier_sync",
  purchase_orders: "po_sync",
  price_lists: "price_list_sync",
  po_suggestions: "po_suggestions",
};

export async function runSync(params: {
  tenantId: string;
  integrationId: string;
  resources?: SyncResource[];
  now?: Date;
  /**
   * Injected rather than resolved from the registry. Same reasoning as
   * runReminderJob taking its db and sender as parameters: this has to run
   * identically from a server action, a scheduled job, and a test with a
   * scripted transport and no ERP anywhere. Omitted in every production
   * caller, which resolves through getConnector().
   */
  connector?: ErpConnector;
}): Promise<SyncSummary> {
  const { tenantId, integrationId } = params;
  const now = params.now ?? new Date();

  const connection = await db.integrationConnection.findUnique({
    where: { tenantId_integrationId: { tenantId, integrationId } },
  });
  if (!connection) throw new Error(`No ${integrationId} connection for this tenant.`);
  if (connection.status !== "CONNECTED") {
    throw new Error(
      `The ${integrationId} connection is ${connection.status}. Reconnect it before syncing.`
    );
  }

  const connector = params.connector ?? getConnector(integrationId);
  const definition = getIntegration(integrationId);
  if (!connector || !definition) throw new Error(`No connector is registered for ${integrationId}.`);

  const session = sessionFor(connection);

  // A connection with no successful run behind it is a first sync, and a
  // first sync must not open the floodgates — see chaseImportedWork below.
  const priorSuccess = await db.integrationSyncRun.findFirst({
    where: { connectionId: connection.id, outcome: { in: ["SUCCEEDED", "PARTIAL"] } },
    select: { id: true },
  });
  const backfill = priorSuccess === null;

  const requested = params.resources ?? (Object.keys(RESOURCE_CAPABILITY) as SyncResource[]);
  const verified = new Set(
    ((connection.config as { verifiedCapabilities?: string[] } | null)?.verifiedCapabilities ??
      definition.capabilities) as string[]
  );

  const results: ResourceResult[] = [];

  // Suppliers first, always. Purchase orders, price lists and suggestions all
  // reference a supplier by external ref, and a PO whose supplier hasn't been
  // imported yet is a skipped row. Ordering costs nothing and removes a whole
  // class of first-sync noise.
  const ordered = (["suppliers", "price_lists", "purchase_orders", "po_suggestions"] as SyncResource[])
    .filter((r) => requested.includes(r));

  for (const resource of ordered) {
    if (!verified.has(RESOURCE_CAPABILITY[resource])) continue;

    const run = await db.integrationSyncRun.create({
      data: { connectionId: connection.id, resource, startedAt: now },
    });

    // Read the watermark before the run, not after: anything changed *during*
    // a long sync must be picked up next time, so the next watermark is this
    // run's start time rather than its finish.
    const since = await watermarkFor(connection.id, resource);
    const result: ResourceResult = { resource, created: 0, updated: 0, skipped: 0, failed: 0 };

    try {
      await syncResource({ connection, connector, resource, session, since, result, backfill, now });
      await db.integrationSyncRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          outcome: result.failed > 0 ? "PARTIAL" : "SUCCEEDED",
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
          watermark: now,
        },
      });
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      await db.integrationSyncRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          outcome: "FAILED",
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
          error: result.error.slice(0, 1000),
        },
      });
      // A sync failing on credentials is a health event, not just a bad run:
      // it has to reach the board, or the connection quietly stops working
      // and the features it feeds quietly stop being right.
      const health = await connector.checkHealth(session).catch(() => null);
      if (health && !health.healthy) await recordHealth(connection.id, health);
    }

    results.push(result);
  }

  return { connectionId: connection.id, results, backfill };
}

async function watermarkFor(connectionId: string, resource: SyncResource): Promise<Date | undefined> {
  const last = await db.integrationSyncRun.findFirst({
    where: { connectionId, resource, outcome: { in: ["SUCCEEDED", "PARTIAL"] } },
    orderBy: { startedAt: "desc" },
    select: { watermark: true },
  });
  return last?.watermark ?? undefined;
}

type SyncContext = {
  connection: IntegrationConnection;
  connector: ErpConnector;
  resource: SyncResource;
  session: ReturnType<typeof sessionFor>;
  since?: Date;
  result: ResourceResult;
  backfill: boolean;
  now: Date;
};

async function syncResource(context: SyncContext): Promise<void> {
  const { connector, session, since, resource } = context;
  const options = since ? { since } : undefined;

  switch (resource) {
    case "suppliers":
      for await (const batch of connector.pullSuppliers(session, options)) {
        await upsertSuppliers(context, batch);
      }
      return;
    case "price_lists":
      for await (const batch of connector.pullPriceLists(session, options)) {
        await upsertPriceLists(context, batch);
      }
      return;
    case "purchase_orders":
      for await (const batch of connector.pullPurchaseOrders(session, options)) {
        await upsertPurchaseOrders(context, batch);
      }
      return;
    case "po_suggestions":
      for await (const batch of connector.pullPOSuggestions(session, options)) {
        await upsertSuggestions(context, batch);
      }
      return;
  }
}

// --- Suppliers -------------------------------------------------------------

async function upsertSuppliers(context: SyncContext, batch: CanonicalSupplier[]): Promise<void> {
  const { connection, result } = context;
  for (const incoming of batch) {
    try {
      const existing = await db.supplier.findFirst({
        where: {
          tenantId: connection.tenantId,
          sourceIntegrationId: connection.integrationId,
          externalRef: incoming.externalRef,
        },
        select: { id: true },
      });

      const data = {
        name: incoming.name,
        primaryContactName: incoming.primaryContactName ?? null,
        primaryContactEmail: incoming.primaryContactEmail ?? null,
        status: incoming.active ? ("ACTIVE" as const) : ("INACTIVE" as const),
      };

      if (existing) {
        await db.supplier.update({ where: { id: existing.id }, data });
        result.updated++;
      } else {
        await db.supplier.create({
          data: {
            tenantId: connection.tenantId,
            sourceIntegrationId: connection.integrationId,
            externalRef: incoming.externalRef,
            ...data,
          },
        });
        result.created++;
      }
    } catch {
      result.failed++;
    }
  }
}

// --- Purchase orders -------------------------------------------------------

/**
 * What the ERP is allowed to say about status.
 *
 * Terminal states always win — a PO closed or voided in Epicor is finished,
 * and continuing to chase it would be the worst kind of wrong. Everything
 * else may only move *forward from DRAFT*. In particular ISSUED never
 * overwrites ACKNOWLEDGED: Epicor cannot see that a supplier answered through
 * ZenoSource, so its "approved and open" is not evidence that they didn't.
 */
function statusToApply(
  current: string,
  incoming: CanonicalPurchaseOrder["status"]
): string | null {
  if (!incoming) return null;
  if (incoming === "CLOSED" || incoming === "CANCELLED") {
    return current === incoming ? null : incoming;
  }
  if (current === "DRAFT" && incoming === "ISSUED") return "ISSUED";
  return null;
}

async function upsertPurchaseOrders(
  context: SyncContext,
  batch: CanonicalPurchaseOrder[]
): Promise<void> {
  const { connection, result } = context;

  // Resolved once for the whole batch, before any transaction opens.
  // Prisma's interactive transactions carry a five-second default timeout,
  // and a per-line lookup inside one means a 40-line order holds it open
  // across 40 extra round trips — the transaction times out and the order is
  // lost, on precisely the large repeat orders that matter most.
  const locations = await resolveLocations(
    connection,
    batch.flatMap((po) => po.lines.map((line) => line.locationRef))
  );

  for (const incoming of batch) {
    try {
      const supplier = await db.supplier.findFirst({
        where: {
          tenantId: connection.tenantId,
          sourceIntegrationId: connection.integrationId,
          externalRef: incoming.supplierExternalRef,
        },
        select: { id: true },
      });
      if (!supplier) {
        // The supplier pass either hasn't run or skipped this one. Attaching
        // the PO to a guessed supplier would put a real order on the wrong
        // company's chase list, so it waits for the next run instead.
        result.skipped++;
        continue;
      }

      const existing = await db.purchaseOrder.findFirst({
        where: {
          tenantId: connection.tenantId,
          sourceIntegrationId: connection.integrationId,
          externalRef: incoming.externalRef,
        },
        select: { id: true, status: true },
      });

      if (existing) {
        await updateMirroredPurchaseOrder(context, existing, incoming, locations);
        result.updated++;
      } else {
        await createMirroredPurchaseOrder(context, supplier.id, incoming, locations);
        result.created++;
      }
    } catch {
      result.failed++;
    }
  }
}

async function createMirroredPurchaseOrder(
  context: SyncContext,
  supplierId: string,
  incoming: CanonicalPurchaseOrder,
  locations: Map<string, string>
): Promise<void> {
  const { connection, backfill } = context;
  const status = incoming.status ?? "DRAFT";

  const purchaseOrderId = await db.$transaction(async (tx) => {
    const number = await allocateDocumentNumber(
      connection.tenantId,
      DOCUMENT_CLASS.PURCHASE_ORDER,
      tx
    );
    const created = await tx.purchaseOrder.create({
      data: {
        tenantId: connection.tenantId,
        number,
        sourceIntegrationId: connection.integrationId,
        externalRef: incoming.externalRef,
        supplierId,
        status,
        issuedAt: status === "DRAFT" ? null : (asDate(incoming.orderDate) ?? context.now),
        lines: {
          create: incoming.lines.map((line) => ({
            lineNumber: line.lineNumber,
            itemNumber: line.itemNumber,
            description: line.description,
            uom: line.uom,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            needByDate: asDate(line.needByDate),
            promiseDate: asDate(line.promiseDate),
            receivedQuantity: line.receivedQuantity ?? null,
            locationId: line.locationRef ? (locations.get(line.locationRef) ?? null) : null,
            status: lineStatusFor(status),
          })),
        },
      },
      select: { id: true },
    });
    await refreshPurchaseOrderTotal(created.id, tx);
    return created.id;
  });

  await mintPurchaseOrderActionItem(context, purchaseOrderId, status, backfill);
}

async function updateMirroredPurchaseOrder(
  context: SyncContext,
  existing: { id: string; status: string },
  incoming: CanonicalPurchaseOrder,
  locations: Map<string, string>
): Promise<void> {
  const nextStatus = statusToApply(existing.status, incoming.status);

  await db.$transaction(async (tx) => {
    for (const line of incoming.lines) {
      const currentLine = await tx.purchaseOrderLine.findFirst({
        where: { purchaseOrderId: existing.id, lineNumber: line.lineNumber },
        select: { id: true, promiseDate: true },
      });

      const shared = {
        itemNumber: line.itemNumber,
        description: line.description,
        uom: line.uom,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        needByDate: asDate(line.needByDate),
        receivedQuantity: line.receivedQuantity ?? null,
      };

      if (currentLine) {
        await tx.purchaseOrderLine.update({
          where: { id: currentLine.id },
          data: {
            ...shared,
            // Ours if we have one. A promise date in ZenoSource came from the
            // supplier committing to it on the action view; Epicor's is a
            // buyer-side expectation. Overwriting the supplier's commitment
            // with our own guess destroys the only record of what they
            // actually agreed to.
            promiseDate: currentLine.promiseDate ?? asDate(line.promiseDate),
          },
        });
      } else {
        await tx.purchaseOrderLine.create({
          data: {
            purchaseOrderId: existing.id,
            lineNumber: line.lineNumber,
            ...shared,
            promiseDate: asDate(line.promiseDate),
            locationId: line.locationRef ? (locations.get(line.locationRef) ?? null) : null,
            status: lineStatusFor(nextStatus ?? existing.status),
          },
        });
      }
    }

    if (nextStatus) {
      await tx.purchaseOrder.update({
        where: { id: existing.id },
        data: { status: nextStatus as never },
      });
    }
    await refreshPurchaseOrderTotal(existing.id, tx);
  });

  // A PO the ERP closed or cancelled stops being chased, whoever owned it.
  if (nextStatus === "CLOSED" || nextStatus === "CANCELLED") {
    await resolveOpenActionItemsFor("PURCHASE_ORDER", existing.id);
    const lines = await db.purchaseOrderLine.findMany({
      where: { purchaseOrderId: existing.id },
      select: { id: true },
    });
    await resolveOpenActionItemsFor(
      "PURCHASE_ORDER_LINE",
      lines.map((l) => l.id)
    );
  } else if (nextStatus === "ISSUED") {
    await mintPurchaseOrderActionItem(context, existing.id, "ISSUED", context.backfill);
  }
}

/**
 * The chase guard, and the most consequential decision in this file.
 *
 * A first sync at a real customer imports thousands of historical orders,
 * many of them open and issued. Minting a supplier-owned action item for each
 * one would put every one of them into the next reminder digest — a mass
 * mailing to hundreds of supplier companies, from a system they have never
 * heard of, about orders they may have already delivered. That is not a
 * strong first impression; it is the thing that gets our sending domain
 * filtered, which silently ends every chase we will ever send that supplier.
 * The Phase 1b design review rejected a per-row nudge button for exactly this
 * reason, and this is the same cannon pointed at the same surface.
 *
 * So on a backfill, internal action items are created normally — the buyer's
 * own board should be full on day one, that's the product working — and
 * external ones are not. The buyer starts the supplier-facing chase
 * deliberately, from a screen that tells them how many suppliers it will
 * reach. Every sync after the first mints both, because by then a newly
 * issued PO is genuinely new.
 */
async function mintPurchaseOrderActionItem(
  context: SyncContext,
  purchaseOrderId: string,
  status: string,
  backfill: boolean
): Promise<void> {
  const { connection } = context;

  const open = await db.actionItem.findFirst({
    where: { subjectType: "PURCHASE_ORDER", subjectId: purchaseOrderId, status: "OPEN" },
    select: { id: true },
  });
  if (open) return;

  if (status === "DRAFT") {
    const lines = await db.purchaseOrderLine.findMany({
      where: { purchaseOrderId },
      select: { locationId: true },
    });
    const owner = await pickInternalOwner(
      connection.tenantId,
      lines.map((l) => l.locationId).filter((id): id is string => Boolean(id))
    );
    if (!owner) return;
    await createActionItem({
      tenantId: connection.tenantId,
      subjectType: "PURCHASE_ORDER",
      subjectId: purchaseOrderId,
      actionType: "PO_ISSUE_DRAFT",
      ownerType: "INTERNAL_USER",
      internalOwnerId: owner,
    });
    return;
  }

  if (status !== "ISSUED") return;
  if (backfill) return; // see the note above

  const purchaseOrder = await db.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { supplierId: true },
  });
  if (!purchaseOrder) return;

  const contact = await db.supplierContact.findFirst({
    where: { supplierId: purchaseOrder.supplierId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!contact) return; // nobody to chase; the supplier record needs a contact first

  await createActionItem({
    tenantId: connection.tenantId,
    subjectType: "PURCHASE_ORDER",
    subjectId: purchaseOrderId,
    actionType: "PO_ACKNOWLEDGE",
    ownerType: "EXTERNAL_USER",
    externalOwnerId: contact.id,
  });
}

function lineStatusFor(poStatus: string) {
  if (poStatus === "CANCELLED") return "CANCELLED" as const;
  if (poStatus === "CLOSED") return "CLOSED" as const;
  if (poStatus === "DRAFT") return "PENDING_ACKNOWLEDGMENT" as const;
  return "PENDING_ACKNOWLEDGMENT" as const;
}

/**
 * Epicor plant codes -> Location ids, for a whole batch in one query.
 *
 * An unmatched code is absent from the map, and the caller stores null rather
 * than a guess: Location is an access-control boundary
 * (docs/architecture.md#tenancy--users), so attaching a line to the wrong one
 * hands a MEMBER another site's orders. A null location is visible and
 * fixable; a wrong one is neither.
 *
 * `externalRef` wins over `code` when both match different locations —
 * externalRef is what an integration set deliberately, code is a human label
 * that happens to collide.
 */
async function resolveLocations(
  connection: IntegrationConnection,
  refs: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const wanted = [...new Set(refs.filter((r): r is string => Boolean(r)))];
  if (wanted.length === 0) return new Map();

  const rows = await db.location.findMany({
    where: {
      tenantId: connection.tenantId,
      OR: [{ externalRef: { in: wanted } }, { code: { in: wanted } }],
    },
    select: { id: true, code: true, externalRef: true },
  });

  const byRef = new Map<string, string>();
  for (const row of rows) {
    if (row.code && wanted.includes(row.code)) byRef.set(row.code, row.id);
  }
  for (const row of rows) {
    if (row.externalRef && wanted.includes(row.externalRef)) byRef.set(row.externalRef, row.id);
  }
  return byRef;
}

// --- Price lists -----------------------------------------------------------

async function upsertPriceLists(context: SyncContext, batch: CanonicalPriceList[]): Promise<void> {
  const { connection, result } = context;

  for (const incoming of batch) {
    try {
      const supplier = await db.supplier.findFirst({
        where: {
          tenantId: connection.tenantId,
          sourceIntegrationId: connection.integrationId,
          externalRef: incoming.supplierExternalRef,
        },
        select: { id: true },
      });
      if (!supplier) {
        result.skipped++;
        continue;
      }

      const existing = await db.priceList.findFirst({
        where: {
          tenantId: connection.tenantId,
          sourceIntegrationId: connection.integrationId,
          externalRef: incoming.externalRef,
        },
        select: { id: true },
      });

      await db.$transaction(async (tx) => {
        let priceListId = existing?.id;

        if (priceListId) {
          await tx.priceList.update({
            where: { id: priceListId },
            data: {
              supplierId: supplier.id,
              effectiveFrom: asDate(incoming.effectiveFrom),
              effectiveTo: asDate(incoming.effectiveTo),
            },
          });
          // A mirrored list is replaced wholesale rather than diffed. The ERP
          // is the source of truth for it, so a break that vanished upstream
          // must vanish here — and a diff that only ever adds would leave a
          // withdrawn price live in the PO-create prefill forever.
          const items = await tx.priceListItem.findMany({
            where: { priceListId },
            select: { id: true },
          });
          await tx.priceBreak.deleteMany({
            where: { priceListItemId: { in: items.map((i) => i.id) } },
          });
          await tx.priceListItem.deleteMany({ where: { priceListId } });
        } else {
          const number = await allocateDocumentNumber(
            connection.tenantId,
            DOCUMENT_CLASS.PRICE_LIST,
            tx
          );
          const created = await tx.priceList.create({
            data: {
              tenantId: connection.tenantId,
              number,
              supplierId: supplier.id,
              sourceIntegrationId: connection.integrationId,
              externalRef: incoming.externalRef,
              effectiveFrom: asDate(incoming.effectiveFrom),
              effectiveTo: asDate(incoming.effectiveTo),
            },
            select: { id: true },
          });
          priceListId = created.id;
        }

        for (const item of incoming.items) {
          await tx.priceListItem.create({
            data: {
              priceListId,
              itemNumber: item.itemNumber,
              description: item.description,
              uom: item.uom,
              priceBreaks: {
                create: item.breaks.map((b) => ({
                  minQuantity: b.minQuantity,
                  unitPrice: b.unitPrice,
                  currency: b.currency,
                })),
              },
            },
          });
        }
      });

      if (existing) result.updated++;
      else result.created++;
    } catch {
      result.failed++;
    }
  }
}

// --- PO suggestions --------------------------------------------------------

async function upsertSuggestions(
  context: SyncContext,
  batch: CanonicalPOSuggestion[]
): Promise<void> {
  const { connection, result } = context;

  for (const incoming of batch) {
    try {
      const supplier = await db.supplier.findFirst({
        where: {
          tenantId: connection.tenantId,
          sourceIntegrationId: connection.integrationId,
          externalRef: incoming.supplierExternalRef,
        },
        select: { id: true },
      });
      if (!supplier) {
        result.skipped++;
        continue;
      }

      const existing = await db.pOSuggestion.findFirst({
        where: {
          tenantId: connection.tenantId,
          sourceIntegrationId: connection.integrationId,
          externalRef: incoming.externalRef,
        },
        select: { id: true, status: true },
      });

      if (incoming.withdrawn) {
        // MRP reran and no longer proposes this. Leaving it OPEN would chase
        // a buyer to act on demand that no longer exists — the reminder loop
        // asking for something nobody needs is the failure mode this product
        // exists to prevent, not commit.
        if (existing && existing.status === "OPEN") {
          await db.pOSuggestion.update({
            where: { id: existing.id },
            data: { status: "SUPERSEDED" },
          });
          await resolveOpenActionItemsFor("PO_SUGGESTION", existing.id);
          result.updated++;
        } else {
          result.skipped++;
        }
        continue;
      }

      const data = {
        supplierId: supplier.id,
        itemNumber: incoming.itemNumber,
        description: incoming.description,
        suggestedQuantity: incoming.suggestedQuantity,
        suggestedDate: asDate(incoming.suggestedDate) ?? context.now,
        suggestedUnitPrice: incoming.suggestedUnitPrice ?? null,
      };

      if (existing) {
        await db.pOSuggestion.update({ where: { id: existing.id }, data });
        result.updated++;
        continue;
      }

      const created = await db.pOSuggestion.create({
        data: {
          tenantId: connection.tenantId,
          sourceIntegrationId: connection.integrationId,
          externalRef: incoming.externalRef,
          ...data,
        },
        select: { id: true },
      });
      result.created++;

      // Suggestions are buyer-owned work, so no chase guard applies — nothing
      // here reaches a supplier. An unreviewed suggestion is exactly the kind
      // of state docs/product.md insists must be owned by someone.
      const owner = await pickInternalOwner(connection.tenantId, []);
      if (owner) {
        await createActionItem({
          tenantId: connection.tenantId,
          subjectType: "PO_SUGGESTION",
          subjectId: created.id,
          actionType: "PO_SUGGESTION_REVIEW",
          ownerType: "INTERNAL_USER",
          internalOwnerId: owner,
        });
      }
    } catch {
      result.failed++;
    }
  }
}

/**
 * `YYYY-MM-DD` -> a Date at UTC midnight.
 *
 * `new Date("2026-08-14")` already parses as UTC midnight, which is exactly
 * what the platform's formatter expects — it renders through a formatter
 * pinned to UTC precisely so a stored date can't drift a day
 * (src/lib/format.ts, Phase 1b Wave 1). Anything with a time component gets
 * its date part taken first, so an ERP timestamp can't reintroduce the drift.
 */
function asDate(value?: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!match) return null;
  return new Date(`${match[1]}T00:00:00.000Z`);
}
