# Architecture

## Repo layout (subprojects)

```
zenosource/
  apps/
    homepage/          # marketing site: home, features, pricing, signup
    platform/           # the product: PO, RFQ, price lists, PO suggestions, supplier collaboration, auth
  integrations/
    erp/
      epicor/            # first ERP integration
    idp/
      okta/              # first IdP integration
  docs/
```

`erp/` and `idp/` are integration *types*, not fixed slots — a second ERP or a second IdP is a new sibling directory, not a rewrite of the first. Each subproject:

- Is independently deployable and may use its own language/framework/tooling. Nothing here assumes a shared stack.
- Gets its own `CLAUDE.md` once it's non-trivial, scoped to that subproject's own conventions. The root `CLAUDE.md` only covers what's true platform-wide.
- Talks to the rest of the system through the canonical entities and capability registry below, not through direct knowledge of another subproject's internals.

## Extensibility & capability model

This is the mechanism behind "integrations should allow certain features to become usable":

1. **Integration registry** — each integration declares `id`, `type` (`erp` | `idp` | ...), and the `capabilities[]` it provides. Example: Epicor declares `po_sync`, `po_suggestions`, `price_list_sync`, `supplier_sync`. Okta declares `sso_oidc`, `sso_saml`, `scim_provisioning`.
2. **Feature registry** — each feature declares the capability (or capabilities) it requires. Example: the PO Suggestions feature requires `po_suggestions`.
3. **Tenant activation** — a tenant's available feature set is the set of features whose required capability is supplied by an integration that tenant has actually connected. Connect Epicor → `po_suggestions` becomes available → PO Suggestions unlocks in the UI and API for that tenant. Disconnect it → the feature turns back off.

IdP integrations fit the same registry even though they gate *auth* capability rather than a procurement feature — `sso_oidc`/`sso_saml`/`scim_provisioning` are capabilities like any other, which keeps one consistent extensibility mechanism instead of a special case for identity.

Treat this registry as the actual extensibility point of the platform: a new integration should only ever need to (a) implement its own subproject, (b) declare its capabilities, and (c) map its data into ZenoSource's canonical entities. It should never require changes to unrelated features.

## Tenancy & users

- **ZenoSource is a single multi-tenant SaaS product** — not self-hosted or deployed per customer. All tenants share one database, isolated by `tenant_id` scoping rather than physically separate data stores.
- **Tenant** = a buyer organization (the manufacturer using ZenoSource to manage their suppliers).
- **Internal users** belong to exactly one tenant and authenticate via that tenant's federated IdP once one is connected (Okta first).
- **External users** (suppliers) are scoped to the POs/RFQs they're invited into. A single supplier plausibly works with multiple buyer tenants, so external-user identity should not be modeled as belonging to one tenant the way internal users are.
- **Location** sits under tenant as a second, finer-grained scope — comparable to (but simpler than) Epicor's Company → Site structure. A tenant spans all of a buyer's Epicor Companies; `Location` is the only sub-tenant scope modeled, standing in for a Site regardless of which Company it belongs to — see [docs/data-model.md#location](data-model.md#location). Internal users are assigned to one or more locations. Unless a user holds the `OWNER` role, they only see and act on POs whose lines target a location they're assigned to.
- Auth is split by population, and for external users, by intent: internal users authenticate via the tenant's federated SSO; external users either resolve one specific action item through a scoped, no-login action-view link (see Action items & reminders below) or use app-native password auth when they want persistent account access. All paths funnel into one session/authorization layer — a scoped action-view grant just carries much narrower authority than a full session. Protocol and provisioning detail: [docs/integrations.md#okta-idp](integrations.md#okta-idp).

## Action items & reminders

ZenoSource is process management software: state alone isn't the product, closing open actions is. Every state-bearing entity (a PO, an RFQ) resolves to at most one open `ActionItem` at a time — an explicit record of what needs to happen next and who owns it.

- **Owner is always a specific user or role**, internal or external — e.g. the supplier contact on a PO awaiting acknowledgment, or the buyer on a PO awaiting approval. An action item without a resolvable owner is a modeling bug, not an edge case to handle later.
- **A daily reminder job (default cadence) notifies the owner of every open action item** until it's resolved — either by the underlying entity changing state, or by the action being explicitly completed. This applies uniformly to internal and external users. v1 reminder channel is **email only**; SMS is a later addition, not a v1 dependency.
- **The in-app dashboard carries equal weight to the email reminder, not less.** On sign-in, both internal and external users should immediately see their open action items, with a count/badge surfacing how many are outstanding before they even open the list. The email is what brings someone back; the dashboard is what they land on.
- **The dashboard inbox is one unified list across every entity type, not a per-type view.** A PO awaiting your review and an RFQ awaiting your review sit in the same list — there's no separate "PO inbox" versus "RFQ inbox." Individual list pages (the PO list, the RFQ list) may still show a per-row "needs your action" indicator as a convenience, but that reads from the same `ActionItem` records; it doesn't fork the mechanism.
- Action items are derived from the state machine, not maintained separately — a state transition should be the only way an action item is created, reassigned, or closed. See [docs/product.md](product.md) for why this is core philosophy, not a notifications feature bolted on later.
- **External users resolve an action item via a scoped link in the reminder email, landing on a dedicated "action view" — no account, no session login.** Possession of the email is treated as sufficient identity proof for that one action. The grant is scoped to exactly that action item and stays valid for as long as the action item is open: clicking the link, leaving the form incomplete, and coming back later reopens the same action view rather than requiring a new link — it's tied to the action item's lifecycle, not single-use, and is revoked once the item resolves. True inbound reply-to-email parsing is explicitly deferred (no v1 dependency on inbound email or AI-based parsing) — the link-to-action-view flow is the whole v1 mechanism. Full password-based login remains available for suppliers who want persistent access, but it's never a precondition for clearing an open action item.

## Data boundaries

- ZenoSource owns its own canonical procurement entities: `PurchaseOrder`, `PurchaseOrderLine`, `RFQ`, `RFQLine`, `RFQSupplierInvite`, `RFQQuote`, `RFQQuoteLine`, `PriceList`, `PriceListItem`, `PriceBreak`, `Supplier`, `POSuggestion`, `ActionItem`. Field-level detail: [docs/data-model.md](data-model.md).
- Where an ERP is connected, the ERP is the source of truth for the fields it owns — ZenoSource mirrors and layers collaboration state (acknowledgment, proposed changes, supplier-facing status) on top rather than treating its own copy as canonical.
- **PO Suggestions specifically**: when Epicor is the connected ERP, Epicor's MRP run is the source of truth. ZenoSource consumes suggestion output, lets buyers act on it, and pushes the resulting decision back through Epicor's requisition/approval path — it does not fabricate or directly write a suggestion itself. See [docs/integrations.md#epicor-erp](integrations.md#epicor-erp) for why that's a hard technical constraint, not just a design choice.
