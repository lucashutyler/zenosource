# TODO

Phased build plan. Nothing here is scaffolded yet — this is the plan, not a status report.

## Phase 0 — Foundations

- [x] `git init` (private repo) — done locally; not yet committed, see [Decided](#decided)
- [x] Scaffold `apps/homepage`, `apps/platform`, `integrations/erp/epicor`, `integrations/idp/okta` as empty subprojects
- [x] Decide canonical entity schema — see [docs/data-model.md](data-model.md) (a few sub-decisions remain open, listed below)
- [x] Decide monorepo vs. polyrepo — monorepo, matching the structure already in place
- [x] Per-subproject `CLAUDE.md` convention — already documented in root [CLAUDE.md](../CLAUDE.md); nothing further until a subproject is non-trivial

## Phase 1 — Core platform MVP (`apps/platform`)

- [ ] Placeholder internal-user auth (before Okta is wired in)
- [ ] Tenant model + role/permission model for internal users
- [ ] PO: create/view, fixed lifecycle state machine
- [ ] RFQ: create/send/collect responses/award
- [ ] Price Lists with quantity price breaks
- [ ] Supplier record + external-user invite flow
- [ ] Integration/capability registry (build this before real integrations exist — feature availability should be driven by it from day one, not retrofitted)
- [ ] Action item model: every state-bearing entity resolves to an open action + explicit owner (internal or external user)
- [ ] Daily reminder job for open action items (email, v1) for both internal and external users
- [ ] Dashboard: surface open action items immediately on sign-in, with a count/badge indicator (internal and external users)
- [ ] Scoped, no-login action-view flow for external users via an emailed link — grant tied to the action item's lifecycle (reopenable, not single-use); inbound reply-to-email parsing deferred to a later phase
- [ ] Reporting: buyer scorecard and supplier scorecard surfaces, built on action-item/state-transition history

## Phase 2 — Epicor integration (`integrations/erp/epicor`)

- [ ] API Key + OAuth2/Basic auth setup, connection health check that distinguishes API-key vs. identity-credential failures
- [ ] PO sync (`POHeader`/`PODetail`/`PORel`) — Epicor → ZenoSource, plus bidirectional status/date/qty updates
- [ ] PO Suggestions ingestion (`POSuggSvc`, read-only) → unlocks the PO Suggestions feature via the capability registry
- [ ] Supplier sync (`VendorSvc`)
- [ ] Vendor-part pricing sync (`VendPartSvc`) → populates `PriceList`/`PriceBreak`
- [ ] Updatable BAQ layer for write-back instead of raw BO calls

## Phase 3 — Okta integration (`integrations/idp/okta`)

- [ ] Per-tenant IdP config storage (SAML metadata / OIDC issuer + client_id)
- [ ] OIDC login flow
- [ ] SAML login flow
- [ ] SCIM 2.0 endpoints (`/Users`, `/Groups`) + Group Push handling, tenant-scoped bearer tokens
- [ ] Tenant resolution by domain/subdomain before assertion/token validation
- [ ] Build the broker abstraction now so a second IdP is a config addition, not a rewrite (see [docs/integrations.md](integrations.md#okta-idp))

## Phase 4 — Homepage (`apps/homepage`)

- [ ] Marketing site: home, features, pricing, signup/contact
- [ ] Pricing page ships with a placeholder ("Coming soon" / "Call for pricing") — actual pricing model is still an open question (see below), don't block launch on it

## Phase 5 — Hardening / launch prep

- [ ] Security review of multi-tenant auth boundaries: internal SSO, external app-native auth, and SCIM token scoping in particular
- [ ] Load/perf pass on Epicor sync paths
- [ ] Identify a design-partner/pilot customer to validate the Epicor integration against a real Kinetic instance

## Decided

- **Repo layout**: monorepo — one repo, independent subproject directories, not literal separate repos.
- **PO cancellation/rejection**: both are explicit statuses on `PurchaseOrder` — `rejected` (supplier-initiated, opens a buyer action item) and `cancelled` (buyer-initiated, reachable from any non-terminal state). See [docs/data-model.md#purchaseorder](data-model.md#purchaseorder).
- **Repo state**: `git init` done locally with a general-purpose `.gitignore`; nothing has been committed yet — that's a deliberate pause, not an oversight (commits only happen when you ask for one).
- **Hosting**: single multi-tenant SaaS — no self-hosted/per-customer deployment.
- **Multi-tenancy**: one shared database, tenants isolated by `tenant_id` scoping, not physically separate data stores.
- **IdP integrations are their own subprojects**, same as ERP integrations (`integrations/idp/okta`, not folded into `apps/platform`'s auth layer).
- **Repo/license**: private.
- **Reminder channel (v1)**: email only — SMS is a later addition, not a v1 dependency. In-app, open action items are the first thing a user sees on sign-in, surfaced with a count/badge; the dashboard is treated as equally central to the reminder system as the email itself.
- **External action-response mechanics**: a scoped link in the reminder email opens a dedicated, no-login "action view." The grant is tied to the action item's lifecycle, not single-use — leaving the form incomplete doesn't burn the link; it stays usable until the action item resolves. True inbound reply-to-email parsing is deferred to a future phase, not a v1 dependency.

## Open questions for you

- **Pricing strategy**: still open by design. For now the homepage pricing page ships with a placeholder ("Coming soon" / "Call for pricing") rather than real numbers — revisit whether the eventual model is flat SaaS tiers, custom/negotiated like SourceDay (~$30K–500K/yr), or plan-based like Axya.
- **ERP #2 / IdP #2**: still open. Even a rough target for each would help validate that the capability-registry and IdP-broker abstractions in [docs/architecture.md](architecture.md) and [docs/integrations.md](integrations.md) generalize past a single example instead of quietly being Epicor/Okta-shaped.
- **Data-model gaps surfaced while drafting the schema**: the exact RFQ status enum, whether an awarded RFQ auto-creates a PurchaseOrder, and the Item/part identity strategy (denormalized strings vs. a dedicated `Item` entity). Full detail: [docs/data-model.md#open-questions-this-doc-surfaces](data-model.md#open-questions-this-doc-surfaces).
