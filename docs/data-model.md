# Data model

Field-level detail for the canonical entities named in [docs/architecture.md](architecture.md#data-boundaries). This is a v1 foundation, not a final schema — expect it to evolve once Phase 1 implementation surfaces gaps. Anything marked **Open** below is a real fork that hasn't been decided; don't treat it as settled.

## Conventions

- Every entity is tenant-scoped (`tenant_id`), consistent with the shared-DB, `tenant_id`-isolated model in [docs/architecture.md](architecture.md#tenancy--users).
- Entities that can either be created natively in ZenoSource or synced in from a connected integration carry `source_integration_id` (nullable FK to the connected integration instance) instead of a hardcoded source enum — adding a second ERP should never require a schema migration to add a new literal value. `null` means natively created.
- Entities synced from an integration also carry `external_ref` — the ID that integration uses for the record (e.g. an Epicor `POHeader` PO number) — so sync logic has something stable to reconcile against.
- All entities have `created_at` / `updated_at`; omitted below for brevity.
- **Item/part identity is denormalized as `item_number` + `description` strings, not a dedicated `Item` entity, for v1.** ZenoSource isn't the system of record for part master data (Epicor is, via its Part master) and a dedicated Item entity would mean owning a redundant master-data sync problem before there's a reason to. **Open**: revisit once a second ERP exists, or once native (no-ERP) item creation is needed for a tenant with no connected ERP.

## Supplier

- `id`, `tenant_id`
- `name`
- `source_integration_id` (nullable), `external_ref` (nullable) — set when synced from Epicor's `VendorSvc`
- `primary_contact_name`, `primary_contact_email` — default owner for action items where no line-level contact is specified
- `status`: `active | inactive`

## PriceList

- `id`, `tenant_id`, `supplier_id` (FK)
- `source_integration_id` (nullable), `external_ref` (nullable) — set when synced from Epicor's `VendPartSvc`
- `effective_from`, `effective_to` (nullable)

## PriceListItem

- `id`, `price_list_id` (FK)
- `item_number`, `description`, `uom`

## PriceBreak

- `id`, `price_list_item_id` (FK)
- `min_quantity` — threshold at which this price takes effect
- `unit_price`, `currency`

## PurchaseOrder

- `id`, `tenant_id`
- `source_integration_id` (nullable), `external_ref` (nullable) — set when synced from Epicor's `POHeader`
- `supplier_id` (FK)
- `status`: `draft | issued | acknowledged | rejected | in_progress | fulfilled | closed | cancelled`
  - `rejected` — supplier explicitly declined the PO at the acknowledgment step (distinct from silence/no-response). Reaching this state opens a `po_review_rejection` action item for the buyer.
  - `cancelled` — buyer terminated the PO before fulfillment. Reachable from `draft`, `issued`, `acknowledged`, `rejected`, or `in_progress` — not from `fulfilled` or `closed`, since there's nothing to cancel once the happy path completed.
- `cancelled_at`, `cancelled_by_user_id` (nullable), `cancellation_reason` (nullable, free text)
- `rejected_at`, `rejection_reason` (nullable, free text — supplier-provided)

## PurchaseOrderLine

- `id`, `purchase_order_id` (FK), `line_number`
- `item_number`, `description`, `uom`
- `quantity`, `unit_price` — snapshot at issuance, independent of whatever `PriceList`/`PriceBreak` informed it; a price list changing later doesn't retroactively change an issued line
- `need_by_date`, `promise_date` (nullable, set once acknowledged)
- `status`: `pending_acknowledgment | acknowledged | change_proposed | fulfilled | closed | cancelled` — cascades to `cancelled` when the header is cancelled while the line hasn't reached a terminal state yet.
- `proposed_change` (nullable: `proposed_quantity`, `proposed_unit_price`, `proposed_date`, `proposed_by_supplier_contact`, `proposed_at`) — the supplier-driven change-proposal flow from product.md; buyer accept/reject resolves it back into `acknowledged` (with the line updated) and closes the associated `ActionItem`.

## RFQ

- `id`, `tenant_id`
- `status`: `draft | sent | responses_open | awarded | closed` — **Open**: this is inferred from "create, distribute, collect and compare, award" in product.md, not stated as explicitly as the PO lifecycle. Worth confirming.

## RFQLine

- `id`, `rfq_id` (FK)
- `item_number`, `description`, `uom`, `quantity`, `need_by_date`

## RFQSupplierInvite

- `id`, `rfq_id` (FK), `supplier_id` (FK)
- `status`: `invited | responded | declined`

## RFQQuote

- `id`, `rfq_id` (FK), `supplier_id` (FK)
- `submitted_at` (nullable)
- `status`: `pending | submitted | withdrawn`

## RFQQuoteLine

- `id`, `rfq_quote_id` (FK), `rfq_line_id` (FK)
- `unit_price`, `lead_time_days`, `notes` (nullable)

On award, `RFQ.status` moves to `awarded` and the winning `RFQQuote` is recorded on the RFQ. **Open**: whether award auto-creates a `PurchaseOrder`, or just marks the RFQ won and leaves PO creation as a separate buyer action, isn't decided.

## POSuggestion

- `id`, `tenant_id`
- `source_integration_id` (required — v1 has no native/ZenoSource-generated suggestions, per [docs/architecture.md](architecture.md#data-boundaries)), `external_ref` — Epicor `POSuggSvc` ID
- `supplier_id` (FK), `item_number`, `description`
- `suggested_quantity`, `suggested_date`, `suggested_unit_price` (nullable — not always present from the source)
- `status`: `open | accepted | rejected | superseded` — accepting doesn't create a firm PO directly; per [docs/integrations.md](integrations.md#epicor-erp) it pushes the decision back through Epicor's requisition/approval path, since Epicor's MRP run is the source of truth.

## ActionItem

- `id`, `tenant_id`
- `subject_type`: `purchase_order | purchase_order_line | rfq | po_suggestion` (polymorphic — the entity that generated this action), `subject_id`
- `action_type` — fixed enum, illustrative and not exhaustive yet: `po_acknowledge`, `po_review_change_proposal`, `po_review_rejection`, `rfq_submit_quote`, `rfq_award_decision`, `po_suggestion_review`
- `owner_type`: `internal_user | external_user`, `owner_id`
- `status`: `open | resolved | superseded`
- `opened_at`, `resolved_at` (nullable)

An action item's `status` / `resolved_at` should only ever change as a side effect of its subject entity's state transition — see [docs/architecture.md](architecture.md#action-items--reminders).

## Open questions this doc surfaces

- Exact RFQ status enum — best inference from product.md, not confirmed.
- Does an awarded RFQ auto-create a PurchaseOrder, or is that a separate buyer action?
- Item/part identity: denormalized strings (current default) vs. a dedicated `Item` entity — revisit once there's a second ERP or native item creation.
