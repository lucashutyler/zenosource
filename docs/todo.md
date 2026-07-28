# TODO

Phased build plan. Nothing here is scaffolded yet — this is the plan, not a status report.

## Phase 0 — Foundations

- [x] `git init` (private repo) — done locally; not yet committed, see [Decided](#decided)
- [x] Scaffold `apps/homepage`, `apps/platform`, `integrations/erp/epicor`, `integrations/idp/okta` as empty subprojects
- [x] Decide canonical entity schema — see [docs/data-model.md](data-model.md) (a few sub-decisions remain open, listed below)
- [x] Decide monorepo vs. polyrepo — monorepo, matching the structure already in place
- [x] Per-subproject `CLAUDE.md` convention — already documented in root [CLAUDE.md](../CLAUDE.md); nothing further until a subproject is non-trivial

## Phase 1 — Core platform MVP (`apps/platform`)

Runnable foundation is in place — see [apps/platform/CLAUDE.md](../apps/platform/CLAUDE.md) for the stack (Next.js 16 + Prisma 7 + Postgres) and local dev setup. `npm run seed` gives you a working login and a live example of the no-login external link, no Epicor/Okta required. What's below is genuinely done vs. still open.

- [x] Placeholder internal-user auth — email/password, signed session cookie, DAL-enforced (`src/lib/dal.ts`). Handles a session referencing a deleted user (a real scenario, not just a dev-reseed artifact) by treating it as unauthenticated rather than rendering broken UI — routed through `/api/session/clear` since Next.js only allows clearing cookies from a Route Handler, not a page render, and redirecting straight to `/login` would loop against `proxy.ts`'s optimistic already-logged-in check.
- [~] Tenant model + role/permission model — `OWNER` vs `MEMBER` is now actually enforced for location-based PO access (see Locations below); no broader permission matrix beyond that
- [x] Locations — `Location` model, user-location assignment, PO/RFQ lines scoped to a location, `OWNER` sees every location while `MEMBER` is restricted to assigned ones. See [docs/data-model.md#location](../docs/data-model.md#location). Comparable-but-simpler stand-in for Epicor's Company → Site structure (one tenant spans all of a buyer's Epicor Companies).
- [x] PO: create/view/edit(draft)/duplicate, fixed lifecycle state machine — full UI: create with lines, issue, buyer cancel (with reason), buyer accept/reject of supplier-proposed changes, real external acknowledge/reject via the no-login link. Every state transition uses an atomic conditional update (`updateMany` + count check) so two people (or the same person in two tabs) can't double-action the same item — see `src/app/actions/purchase-orders.ts`. Verified end-to-end in a browser, including the double-action race specifically.
- [x] RFQ: create (lines + supplier invites), list/filter/sort, detail with quote comparison, award (records the winning `RFQQuote` via `RFQ.awardedQuoteId`), close, duplicate. No external no-login quote-submission flow yet — a supplier responding to an RFQ isn't wired up (only the buyer side is); quote comparison is correct but shows "no quotes yet" until that lands.
  - [ ] Gap: RFQ CRUD doesn't create `ActionItem`s anywhere (not on send, not on award) — `RFQ_SUBMIT_QUOTE` and `RFQ_AWARD_DECISION` exist as action types but nothing ever generates one. The seed script hand-creates one `RFQ_AWARD_DECISION` item purely to exercise the dashboard's link-resolution path; it's not something the app produces on its own yet.
- [x] Price Lists with quantity price breaks — create a price list per supplier, add items with an initial price break, add further price breaks to an item, duplicate a whole price list.
- [x] Supplier record + external-user invite flow — create supplier, add contacts, both through the app now
- [x] Action item model — `ActionItem` schema + create/resolve/list/count helpers (`src/lib/action-items.ts`), plus an atomic `tryResolveActionItem` guard against double-resolution
- [x] Daily reminder job — `src/lib/reminders.ts` groups every open action item by owner and sends one digest per owner through a pluggable `EmailSender` interface (`src/lib/email/sender.ts`); ships with a dummy console-logging implementation since no provider is chosen yet — swapping in a real one later is a new class + one factory line, not a rewrite. Runnable via `npm run send-reminders`; not yet wired to an actual scheduler (cron/GitHub Actions/hosting-platform cron) since no hosting platform is chosen either — see open questions.
- [x] Dashboard: open action items on sign-in with a count badge — one unified inbox across every entity type, not a per-type view (`src/app/dashboard/`). Each item links to its actual subject (resolving a `PurchaseOrderLine` subject to its parent PO) and the target page highlights the specific line the action is about. `PO_SUGGESTION` items have no link target yet since that page doesn't exist until Phase 2.
- [x] Left-nav app shell — collapsible sidebar with icons, off-canvas drawer + backdrop on mobile (auto-closes on nav or backdrop click), user flyout menu (About + Sign out), full-width page content, indigo accent palette (`src/app/dashboard/shell.tsx`)
- [x] Scoped, no-login action-view flow — `src/app/a/[token]/`, tested end-to-end (grant persists across reload, dies once resolved, and reopening an already-resolved link in a second tab correctly shows "already resolved" instead of re-processing)
- [x] List/filter/sort/duplicate on top of the action-item mechanism — the PO list supports status/location filters and sort; PO detail supports duplicating an existing PO into a new draft. Editing is only offered for `DRAFT` POs (post-issuance changes go through the propose/accept-reject flow instead, on purpose — a direct edit would bypass the state machine).
- [ ] Reporting: buyer scorecard and supplier scorecard surfaces — not built
- [x] Automated tests + CI — Vitest (unit/integration, dedicated `zenosource_test` DB) and Playwright (E2E, including the double-action race specifically) via `npm test` / `npm run test:e2e`; GitHub Actions workflow (`.github/workflows/platform-ci.yml`) runs both plus typecheck/lint on push/PR once this repo has a remote. See [apps/platform/CLAUDE.md](../apps/platform/CLAUDE.md#testing).
  - [ ] Gap: `prisma/migrations/` only captures the initial schema — two later changes (`Location`, `RFQ.awardedQuoteId`) were applied via `db push` instead of a real migration, because `prisma migrate dev` refuses to run non-interactively in an agent-driven session. Fine for local/CI (`db push`-based), but `prisma migrate deploy` (the real-deploy command) would miss them — generate proper migration files before any actual deployment.

## Phase 2 — Epicor integration (`integrations/erp/epicor`)

- [ ] Integration/capability registry — moved from Phase 1: the concept is designed in [docs/architecture.md](architecture.md#extensibility--capability-model) but there's no code for it yet. This is platform infrastructure, not Epicor-specific, but it has nothing real to register or gate until an actual integration exists — building it against zero integrations would be speculative scaffolding, not tested infrastructure. Build this first in this phase, before the Epicor-specific work below, since PO Suggestions depends on it.
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
- **Hosting/scheduling platform**: not chosen yet, and the daily reminder job needs something to actually trigger it on a schedule (cron, a hosting platform's built-in cron, GitHub Actions on a schedule, etc.). `npm run send-reminders` runs the job on demand right now; wiring it to fire automatically is blocked on this choice, same as the email provider is blocked on picking one.
