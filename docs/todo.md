# TODO

Phased build plan. Nothing here is scaffolded yet — this is the plan, not a status report.

## Phase 0 — Foundations

- [x] `git init` (private repo) — done locally; not yet committed, see [Decided](#decided)
- [x] Scaffold `apps/homepage`, `apps/platform`, `integrations/erp/epicor`, `integrations/idp/okta` as empty subprojects
- [x] Decide canonical entity schema — see [docs/data-model.md](data-model.md) (a few sub-decisions remain open, listed below)
- [x] Decide monorepo vs. polyrepo — monorepo, matching the structure already in place
- [x] Per-subproject `CLAUDE.md` convention — already documented in root [CLAUDE.md](../CLAUDE.md); nothing further until a subproject is non-trivial

## Phase 1 — Core platform MVP (`apps/platform`)

**Closed 2026-07-28.** Runnable foundation is in place — see [apps/platform/CLAUDE.md](../apps/platform/CLAUDE.md) for the stack (Next.js 16 + Prisma 7 + Postgres) and local dev setup. `npm run seed` gives you a working login and a live example of the no-login external link, no Epicor/Okta required. Everything still open at close-out (reporting scorecards, the RFQ action-item gap, the migration-history gap) moved to [Phase 1a](#phase-1a--close-out-the-core-loop-appsplatform) below, which was scoped from a full audit of the app.

- [x] Placeholder internal-user auth — email/password, signed session cookie, DAL-enforced (`src/lib/dal.ts`). Handles a session referencing a deleted user (a real scenario, not just a dev-reseed artifact) by treating it as unauthenticated rather than rendering broken UI — routed through `/api/session/clear` since Next.js only allows clearing cookies from a Route Handler, not a page render, and redirecting straight to `/login` would loop against `proxy.ts`'s optimistic already-logged-in check.
- [~] Tenant model + role/permission model — `OWNER` vs `MEMBER` is now actually enforced for location-based PO access (see Locations below); no broader permission matrix beyond that. Defining the rest of the matrix — and fixing the enforcement holes the close-out audit found in what's here — moved to Phase 1a.
- [x] Locations — `Location` model, user-location assignment, PO/RFQ lines scoped to a location, `OWNER` sees every location while `MEMBER` is restricted to assigned ones. See [docs/data-model.md#location](../docs/data-model.md#location). Comparable-but-simpler stand-in for Epicor's Company → Site structure (one tenant spans all of a buyer's Epicor Companies).
- [x] PO: create/view/edit(draft)/duplicate, fixed lifecycle state machine — full UI: create with lines, issue, buyer cancel (with reason), buyer accept/reject of supplier-proposed changes, real external acknowledge/reject via the no-login link. Every state transition uses an atomic conditional update (`updateMany` + count check) so two people (or the same person in two tabs) can't double-action the same item — see `src/app/actions/purchase-orders.ts`. Verified end-to-end in a browser, including the double-action race specifically.
- [x] RFQ: create (lines + supplier invites), list/filter/sort, detail with quote comparison, award (records the winning `RFQQuote` via `RFQ.awardedQuoteId`), close, duplicate. No external no-login quote-submission flow yet — a supplier responding to an RFQ isn't wired up (only the buyer side is); quote comparison is correct but shows "no quotes yet" until that lands.
  - Gap, moved to Phase 1a: RFQ CRUD doesn't create `ActionItem`s anywhere (not on send, not on award) — `RFQ_SUBMIT_QUOTE` and `RFQ_AWARD_DECISION` exist as action types but nothing ever generates one. The seed script hand-creates one `RFQ_AWARD_DECISION` item purely to exercise the dashboard's link-resolution path; it's not something the app produces on its own yet. Absorbed into Phase 1a's "action items derive from the data" work.
- [x] Price Lists with quantity price breaks — create a price list per supplier, add items with an initial price break, add further price breaks to an item, duplicate a whole price list.
- [x] Supplier record + external-user invite flow — create supplier, add contacts, both through the app now
- [x] Action item model — `ActionItem` schema + create/resolve/list/count helpers (`src/lib/action-items.ts`), plus an atomic `tryResolveActionItem` guard against double-resolution
- [x] Daily reminder job — `src/lib/reminders.ts` groups every open action item by owner and sends one digest per owner through a pluggable `EmailSender` interface (`src/lib/email/sender.ts`); ships with a dummy console-logging implementation since no provider is chosen yet — swapping in a real one later is a new class + one factory line, not a rewrite. Runnable via `npm run send-reminders`; not yet wired to an actual scheduler (cron/GitHub Actions/hosting-platform cron) since no hosting platform is chosen either — see open questions.
- [x] Dashboard: open action items on sign-in with a count badge — one unified inbox across every entity type, not a per-type view (`src/app/dashboard/`). Each item links to its actual subject (resolving a `PurchaseOrderLine` subject to its parent PO) and the target page highlights the specific line the action is about. `PO_SUGGESTION` items have no link target yet since that page doesn't exist until Phase 2.
- [x] Left-nav app shell — collapsible sidebar with icons, off-canvas drawer + backdrop on mobile (auto-closes on nav or backdrop click), user flyout menu (About + Sign out), full-width page content, indigo accent palette (`src/app/dashboard/shell.tsx`)
- [x] Scoped, no-login action-view flow — `src/app/a/[token]/`, tested end-to-end (grant persists across reload, dies once resolved, and reopening an already-resolved link in a second tab correctly shows "already resolved" instead of re-processing)
- [x] List/filter/sort/duplicate on top of the action-item mechanism — the PO list supports status/location filters and sort; PO detail supports duplicating an existing PO into a new draft. Editing is only offered for `DRAFT` POs (post-issuance changes go through the propose/accept-reject flow instead, on purpose — a direct edit would bypass the state machine).
- Reporting: buyer scorecard and supplier scorecard surfaces — not built; **moved to Phase 1a**, which also pins the actual metric list and the schema/seed prerequisites the metrics need.
- [x] Automated tests + CI — Vitest (unit/integration, dedicated `zenosource_test` DB) and Playwright (E2E, including the double-action race specifically) via `npm test` / `npm run test:e2e`; GitHub Actions workflow (`.github/workflows/platform-ci.yml`) runs both plus typecheck/lint on push/PR once this repo has a remote. See [apps/platform/CLAUDE.md](../apps/platform/CLAUDE.md#testing).
  - Gap, moved to Phase 1a: `prisma/migrations/` only captures the initial schema — two later changes (`Location`, `RFQ.awardedQuoteId`) were applied via `db push` instead of a real migration, because `prisma migrate dev` refuses to run non-interactively in an agent-driven session. Fine for local/CI (`db push`-based), but `prisma migrate deploy` (the real-deploy command) would miss them — generate proper migration files before any actual deployment.

## Phase 1a — Close out the core loop (`apps/platform`)

Phase 1 built the surface; this phase makes the product's core claim — every state resolves to an owned, chased action — actually true. Scoped from a full close-out audit of the app (2026-07-28: six parallel area sweeps plus an adversarial completeness pass; findings spot-verified against source). The organizing bug: `ActionItem` rows are created by exactly two code paths in the whole app (`issuePurchaseOrder`, `rejectPOByToken`), so on seeded data a user sees 12 active POs + 3 drafts + 4 open RFQs but an inbox badge of 3. **Open-item counts must come from the data — a parallel table that drifts out of sync with entity state is exactly the bug.**

### Correctness and access-control fixes (bugs in what shipped — do these first)

**Closed 2026-07-28.** All five verified with new tests (7 new E2E specs, 2 new Vitest files) — `npm test` (23/23) and `npm run test:e2e` (15/15) both green.

- [x] External token actions skip the atomic status guard — `acknowledgePOByToken` / `rejectPOByToken` (`src/app/actions/purchase-orders.ts`) now guard their PO write with `updateMany({status: "ISSUED"})`, matching every internal transition; a status change that lands first (e.g. a concurrent cancel) is reported back as "changed before your response could be recorded" instead of being overwritten. Covered by `src/app/actions/purchase-orders.test.ts`, which reproduces the race deterministically (flip status mid-flow, assert no resurrection).
- [x] Terminal transitions strand open items — `resolveOpenActionItemsFor` now accepts an array of subject ids; `cancelPurchaseOrder` resolves both the PO's own items and every one of its lines', and `closeRFQ` / `awardRFQQuote` resolve the RFQ's open items. Covered by two new E2E specs (`purchase-orders.spec.ts`, `rfqs.spec.ts`) using self-contained fixtures.
- [x] Line `locationId` is never validated against the tenant — added `allLocationsBelongToTenant()` (`src/lib/access.ts`), checked before the MEMBER scope check in `createPurchaseOrder`, `updateDraftPurchaseOrder`, and `createRFQ`, for every role. Covered by `src/lib/access.test.ts`.
- [x] `?status=` on the PO and RFQ lists is cast to the Prisma enum unvalidated — both pages now validate against their `STATUS_TONE` map's keys before use; an invalid value is ignored (renders unfiltered) rather than 500ing. Covered by new E2E specs on both list pages.
- [x] Location scoping is escapable and half-applied — `assignUserToLocation` and `createLocation` are now OWNER-gated (UI hides the affordances for MEMBERs too); the PO list's `?locationId=` now intersects with the caller's scope instead of replacing it; RFQ list/detail/`closeRFQ`/`awardRFQQuote`/`duplicateRFQ` now all consult `locationScopeFor` via a shared `hasLocationAccess()` helper, matching the PO pattern. Covered by new E2E specs. Team-management OWNER-gating (the matrix's third leg) can't be enforced yet since team management doesn't exist as a feature — tracked under Missing lifecycle actions below.

### Action items derive from the data

The dashboard badge, inbox, and widgets must agree with entity state by construction. `ActionItem` stays as the carrier of ownership and the external access token, but every state transition creates/resolves the items it implies, and user-facing counts are computed from the entities themselves — so the two can never disagree.

- [~] Wire creation into every producer that lacks one — **done for PO issue and RFQ send** (2026-07-28): `issuePurchaseOrder` and `createRFQ` now both create their action item (`PO_ACKNOWLEDGE`, one `RFQ_SUBMIT_QUOTE` per invited contact) unconditionally, since both now *block* rather than silently skip when a supplier has no contact (see below) — so there's no code path left where the entity transitions without the item existing. `closeRFQ`/`awardRFQQuote` already resolve every open item on the RFQ from the correctness-fixes pass above, so newly-created `RFQ_SUBMIT_QUOTE` items compose with that for free. **Still open**: supplier propose-change (blocked on that flow existing at all — see [Phase 1b's external surface](#wave-3--the-supplier-surface)) and buyer-owned `RFQ_AWARD_DECISION` on first quote in (blocked on the RFQ quote-submission flow existing — no quote can be submitted yet, so there's no trigger point to hook into).
- Add the missing `ActionItemType`s (PO `DRAFT`, `ACKNOWLEDGED`/`IN_PROGRESS`, `FULFILLED`; RFQ `DRAFT`, `AWARDED`) — **moved to [Phase 1b](#wave-4--no-unowned-states)**, because each type has to land with the lifecycle action that produces it, and all of those producers are Phase 1b work.
- [x] Kill the silent skips (2026-07-28) — `issuePurchaseOrder` now returns a clear form error and refuses to transition when the supplier has zero contacts, instead of silently landing in `ISSUED` with no acknowledge item (it's now a client-component form via `useActionState`, mirroring `CancelForm`, so the error actually renders); `createRFQ` got the identical guard for every invited supplier before creating anything. Letting the buyer *pick* the recipient contact (rather than always using `contacts[0]`) is real remaining UX work, tracked under [Phase 1b's master data](#wave-5--reference-data-and-the-long-tail), but the unowned-state bug itself is closed. `rejectPOByToken`'s `pickInternalOwner`-returns-null case is left as is — every tenant has exactly one `OWNER` by construction (there's no path to create a tenant without one), so this is a defensive branch for a state that can't currently occur, not a live bug; revisit if team management ever allows removing the last `OWNER`.
- [x] Scope the PO list's "needs your action" dot to the viewer (2026-07-28) — now filters on `ownerType: INTERNAL_USER, internalOwnerId: user.id`, matching the dashboard inbox's own query exactly, instead of lighting up for any open `PURCHASE_ORDER`-subject item in the tenant regardless of owner.

All four covered by new E2E specs: `e2e/rfqs.spec.ts` (contact-less-supplier block, `RFQ_SUBMIT_QUOTE` creation on send) and `e2e/purchase-orders.spec.ts` (contact-less-supplier block, the dot's ownership scoping) — `npm test` (23/23) and `npm run test:e2e` (19/19) both green.
- Surface the supplier's court ("whose court is the ball in" is invisible to every internal user) — **moved to [Phase 1b](#phase-1b--the-ledger-uxui-appsplatform)**, where it lands with the dashboard widgets it belongs beside.

### Missing lifecycle actions, identity and context, dashboard widgets, list and form UX

**All four sections moved to [Phase 1b](#phase-1b--the-ledger-uxui-appsplatform)** (2026-07-28), re-sequenced there against the user-testing findings in [test1a.md](test1a.md). They were scoped from a code audit; Phase 1b re-scoped them from watching six personas actually try to do the work, which changed the ordering (document numbers turn out to gate five other items) and surfaced 60 additional problems the code audit couldn't see. Nothing was dropped in the move.

What stays in Phase 1a is the part that isn't interface work: the action-item derivation above, the reporting prerequisites below, seed data, and migration history.

### Reporting scorecards (moved from Phase 1)

**Closed 2026-07-29.**

- [x] Pin the metric list into [docs/product.md](product.md#the-scorecard-metrics-pinned) — done, as a table per scorecard with the derivation of each figure, plus the reason there is no metric picker.
- [x] Schema before UI — landed as `20260729093000_reporting_history_and_document_numbers`: the `StatusEvent` transition log (what product.md promises the scorecards are "built on"), PO `issuedAt`/`acknowledgedAt`/`fulfilledAt`/`closedAt`, line `receivedAt`/`receivedQuantity`, `POLineChangeProposal` (accept/reject used to null the proposal in place, destroying the outcome), RFQ `sentAt`/`awardedAt`/`closedAt`/`quoteDeadline`, invite `respondedAt`/`declinedAt`, and `ActionItem` resolved-by attribution plus `lastRemindedAt`/`reminderCount`. Both the event log and the denormalized timestamps are written by one helper (`recordStatusChange`), so they cannot drift.
- [x] `/dashboard/reports` — supplier and buyer scorecards, fixed 90-day window, fixed metric set (`src/lib/scorecards.ts`). Ranked by value held. A metric with too little history renders as an em dash, never a zero.

### Seed data v2

- [x] **Closed 2026-07-29.** ~130 POs and 14 RFQs across ~6 backdated months, weighted 55% closed / 13% received / 12% in flight / 10% issued / 6% draft / 4% cancelled, with timestamps set explicitly. Five supplier personas with visibly different acknowledgment latency, on-time rate, change rate and quote behaviour, so a ranking means something rather than proving only that the query runs. ~208 resolved action items with realistic open→resolved gaps and chase counts, 562 status events, staggered quotes and declines. Line statuses agree with their headers (the previous seed shipped CLOSED orders carrying ACKNOWLEDGED lines). Deterministic: a seeded PRNG, so the data varies without varying between runs. po1/po2/po3 kept stable for the specs that depend on them, and the `wipe()`/E2E deletion order updated for the two new tables.

### Carried-over infrastructure debt

- [x] **Migration history — closed 2026-07-29, and the class of bug closed with it.** The four `db push` changes are captured in `20260729090000_close_push_drift`. Local, CI and E2E all now apply migrations with `prisma migrate deploy` rather than pushing the schema, so every test run exercises them; and `typecheck-and-lint` runs `prisma migrate diff --from-migrations --to-schema --exit-code`, which fails the build if the migrations directory stops reproducing `schema.prisma`. Three migrations, no drift.
- [~] The notification loop — **the product half is done** (2026-07-29): issuing a PO and sending an RFQ each email the supplier immediately rather than waiting for a digest, `ActionItem.lastRemindedAt`/`reminderCount` record what was sent when, and `/dashboard/emails` shows the envelope and renders the HTML body in a 390px phone frame. **Still blocked on you**: a real email provider behind the existing `EmailSender` interface, and a scheduler to trigger the daily job (open questions below). `npm run send-reminders`, the `Chase all N` button, and the button on `/dashboard/emails` all run it on demand meanwhile.

## Phase 1b — The Ledger (UX/UI) (`apps/platform`)

Phase 1a made the core loop *correct*. This phase makes it **usable, and makes it ours.** Scoped from two passes over the Phase 1a build on 2026-07-28: [test1a.md](test1a.md), a twelve-pass user-testing audit that produced 185 verified findings; and [test1a-2.md](test1a-2.md), four rival design directions judged by a founder, a procurement manager, and a design lead.

**The decision: those were never two projects.** The design direction's kill list and the audit's fix list are largely the same list — Arial, card-per-row lists, the `Apply` button, `Newest first`, four badge tones carrying nine statuses, three money formats, the red `Cancel PO`. Paying those down as 185 separate defects costs more than fixing them once as one system, and leaves the product with no point of view at the end of it. So: one phase, one order, and the order follows **dependency** rather than severity or aesthetics.

**The spine.** *Saturation is reserved for time and ownership. Nothing else in the product gets a hue.* One rule, enforceable in review with a grep, redundantly encoded in stroke weight so it survives greyscale, colour-blindness and print.

**Why it's affordable.** `ActionItem.openedAt` and `ownerType` already exist and `openedAt` is already the `orderBy` key in `listOpenActionItemsForInternalUser`; `needByDate` is already collected and stored. Age, dwell, heat and whose-court are computable today with no migration. The most differentiated thing this product can do is already in the database — nobody has given it a colour.

**The competitive bet, in one sentence:** *nobody else draws the clock.* SourceDay's urgency is a `Hot` sticker a human has to remember to apply; Axya's `Late` pill renders one-day-late and forty-days-late identically.

**Closed 2026-07-29.** All five waves shipped. `npm test` (56/56), `npm run test:e2e` (39/39), typecheck, lint and `next build` all green; migrations, not `db push`, everywhere. What the phase actually produced, in one paragraph per wave, is at the end of this section under [What shipped](#what-shipped). Three things found *during* the build, none of which the audit could have seen, are recorded there too — they were all real bugs in code written this phase.

### Decisions made, so they stop being open

1. **Type: Geist Sans + Geist Mono. No serif, anywhere.** Both design reviews flagged the serif as the most replaceable component in the direction; two of three judges wanted it cut from opposite surfaces. Cutting it entirely removes the disagreement and one more thing to get wrong. Geist Mono carries every comparable number — ages, quantities, money, document numbers.
2. **Currency: USD-only for v1.** Drop the ISO suffix from price breaks rather than exposing an input. Revisit at the first non-US tenant, not before. (Closes the open question in Phase 1a's price-list bullet.)
3. **Dates: `28 Jul 2026`, one format, everywhere** — and normalize storage so the timezone bug cannot come back.
4. **Numbering: one tenant-scoped sequence with class letters** — `P-10418`, `Q-10422`, `L-10007`. Not per-entity sequences: one number space means `10418` alone is unambiguous over a phone.
5. **Sort: `WAITING` descending is the default on every list, and the `Sort` dropdown is deleted.** There is one right order for a chase product and it is not the user's to choose.
6. **Every column added here lands as a real migration**, and the four-change `db push` drift from Phase 1a gets closed in Wave 1 while we're in there — that drift is what produced the phantom "supplier surface is down" crash during the audit.

### Four standing laws (engineering gates, checked in review)

- [x] **At-rest work gets no clock.** No open `ActionItem` → the `WAITING` cell is blank, not `age-0`. Most of a real tenant is at rest. Without this, a customer's first login is a wall of oxblood.
- [x] **The full age ramp applies only to items assigned to you** (bounded by human capacity). Entity lists use the muted variant.
- [x] **Rank by dwell × value, not dwell.** A 40-day-old $200 PO and a 4-day-old $80,000 PO currently render identically, and every buyer chases the second one first.
- [x] **A state that mints no `ActionItem` must render as suspiciously neutral.** This turns *"a status nobody is being reminded to act on is a modeling bug"* into something visible. Audit every transition for an action item before this ships.

### Applied in every wave, not deferred to the end

Accessibility and mobile are acceptance criteria on each wave's own surfaces, not a trailing cleanup — the audit found the foundations already good (correct landmarks, one `<h1>` per page, real tables, `aria-hidden` on decorative icons, clean 200% zoom) and the failures specific and local.

- [x] Every wave: form errors associated (`aria-describedby`), announced (`role="alert"`), focus moved to the first failure; state transitions announced and focus managed; visible focus states including forced-colors mode; no tap target under 44px; no horizontal overflow at 390px; a designed empty state.
- [x] **Test at 400 rows before shipping anything.** Every design direction here was drawn against a six-row screenshot. A real tenant runs ~40 POs in flight and ~900 rows at rest.

---

### Wave 1 — Stop the bleeding, lay the spine

Everything here is either actively wrong or gates everything downstream. Three of these are nearly free and one is a single line.

- [x] **Sign out doesn't sign you out.** The flyout container's `onClick={() => setOpen(false)}` ([user-menu.tsx:36](../apps/platform/src/app/dashboard/user-menu.tsx:36)) unmounts the logout `<form>` before its submit event dispatches — the session cookie survives and `/dashboard` still renders. Real exposure on a shared workstation. Add an E2E spec asserting the cookie is gone.
- [x] **Every user-entered date renders one day early.** `new Date("2026-08-18")` → UTC midnight; `.toLocaleDateString()` with no `timeZone` renders it in the server's zone. Typed 8/18, displays 8/17, at all 13 call sites. Fix storage and render through one formatter.
- [x] **A validation error wipes the whole form** — supplier, all five lines, all dates, ~35 fields destroyed by one missing Location. Echo the submitted `FormData` back into `defaultValue`, and validate client-side first.
- [x] **Per-field validation errors.** `Line N: Invalid input` is the only message the PO and RFQ forms can produce. Mark required fields — Location is the one required line field that isn't marked, while optional fields elsewhere say `(optional)`.
- [x] **Give every form control an `id`.** 40 controls on the new-PO form, 0 labelled, 36 orphan `<label for>` ([ui.tsx:14](../apps/platform/src/components/ui.tsx:14)). One fix in one file covers nearly the whole app.
- [x] **Guard terminal actions.** Award, Close RFQ, Accept/Reject proposal are plain grey buttons that fire instantly — and are exactly the 7 `SubmitButton`s with no `pending` prop, so they don't even disable. Confirm-on-irreversible, consistent placement and reason capture, pending state everywhere.
- [x] **Delete `body { font-family: Arial, Helvetica, sans-serif }`** from [globals.css:25](../apps/platform/src/app/globals.css:25) — `create-next-app` boilerplate overriding the Geist webfonts `layout.tsx` downloads and discards on every page load.
- [x] **Ship the token set.** Warm paper (`--paper #FBFAF8`, `--ink #1A1817`, `--rule #E4E0D9`); five-step oxidation ramp for age (`age-0 #8B8D8F` steel → `age-4 #8E2C1E` oxblood) with stroke weight rising alongside hue; `--court-them #1B4FB8` cobalt; `--verdigris #3D7A6B` for resolved. Dark mode is the same ramp on `#151312` and finally declares `color-scheme`, fixing light dropdowns inside dark fields.
- [x] **Retire coloured status badges and the indigo accent.** Nine PO statuses share four tones today, so `closed` grey sits beside `fulfilled` green; every hue spent on state was stolen from time. `#4F46E5` is Tailwind's default and the product's only "brand" — under the spine, only state has colour.
- [x] **Document numbers**: one tenant-scoped sequence, class letters, `@@unique([tenantId, number])`. Gates lists, search, the inbox, emails, the external view and print — settle it before anything downstream.
- [x] **`WAITING` descending as the default sort**, with a mono `WAITING` column (`today` / `3d` / `11d`) coloured by the ramp. One `orderBy`; the highest-value single change in the phase.
- [x] **Close the migration-history drift** (`Location`, `RFQ.awardedQuoteId`, `CapturedEmail`, the `SupplierContact.passwordHash` drop) and land this wave's columns as real migrations. *(Moved up from Phase 1a's infrastructure debt — it stops being deferrable the moment we add columns.)*

### Wave 2 — Make the work visible

The buyer's surfaces, rebuilt on the spine. This is the wave that produces a demo you can win with.

- [x] **`/dashboard` leads with "You owe 3. They owe 11."** at display size, then splits into your court / their court, hottest first. The "waiting on supplier" half does not exist anywhere in the product today, and it's the answer to the question the product exists to answer.
- [x] A MEMBER with no assigned items sees *"Board clear. 15 purchase orders in your locations, none waiting on anyone."* — Casey currently gets a blank page while 15 in-scope POs sit in her list.
- [x] **`Chase all N`** at the masthead, aggregating by **recipient** (which `runReminderJob` already does), never per-row. Add `ActionItem.lastRemindedAt` + `reminderCount` and a 24h server-side cooldown. Per-row nudge would be a spam cannon aimed at our most-distributed surface.
- [x] **Lists become ledgers** — hairlines, not cards. Columns `№ · SUPPLIER · WHAT'S OWED · WAITING · VALUE · NEED BY`, where `WHAT'S OWED` is a sentence (*"Precision Parts: acknowledge"* / *"You: review the rejection"* / *"Nobody — closed 6/14"*). Absorbs the 30-identical-cards-with-880px-of-dead-space finding.
- [x] **Search** over document number, supplier, item number and description, plus a supplier filter. "The supplier called about SKU-2050" currently requires opening all 25 POs and still returns 8 candidates.
- [x] Filters auto-apply (drop `Apply`), sortable headers, pagination — every list is an unbounded `findMany` today, including the inbox.
- [x] **PO detail becomes a document**: `P-10418` in mono, order total, extended line values, need-by and promise date columns, `Cancel PO` demoted from solid red to quiet text with the colour living in the confirm.
- [x] **The change proposal becomes a real diff** — old value struck through → new — with **extended value as the last and heaviest row**, because a 441% jump on a tiny line matters less than 4% on a big one. We currently lose head-to-head with SourceDay on the one interaction this product is named for, and it's a layout problem: the old values are already in the row.
- [x] Surface the outcome of accept/reject on the PO and tell the supplier; today it leaves no trace anywhere.
- [x] **Designed route states.** There are zero `loading.tsx` / `error.tsx` / `not-found.tsx` / `global-error.tsx` files in the app. Navigation gives no feedback for up to a second; a scope-denied MEMBER and a missing record produce the same bare framework 404.
- [x] **Kill the 5-line cap** — `LINE_SLOTS = 5` with parsers reading indices 0–4 silently discards a sixth line and would drop the tail when editing a longer PO. Add-row UI, index-driven parsing, and stop skipping rows that have data but a blank item number.
- [x] **Price-list awareness on PO create**: unit price pre-fills from the matching `PriceBreak` *for the quantity typed*, annotated `from schedule L-10007`; an override marks `off schedule +403%`. Buildable from `PriceBreak` today. Fixes the line saved at $44 against a negotiated $8.755, and the procurement-manager judge rated it the single highest-value item in either review.
- [x] **Print.** A real `@media print` stylesheet for the PO: running masthead, parties block, totals under a double rule, `break-inside: avoid`, footer `P-10418 · Acme Manufacturing · page 1 of 2`, plus a print-to-PDF regression test on a 12-line multi-location order. Neither competitor has a printable artifact in any form.
- [x] Per-page `metadata` titles (all 23 routes are titled "ZenoSource"), back links, `aria-current`, a skip link, and organization / role / location scope shown somewhere in the chrome.
- [x] Supplier detail shows related records — open POs, RFQs and price lists. Today it's a dead end listing contacts.
- [x] Locations list is tenant-scoped but not location-scoped ([locations/page.tsx:9](../apps/platform/src/app/dashboard/locations/page.tsx:9)) — a MEMBER sees every location in the tenant.

### Wave 3 — The supplier surface

The differentiator, and the most-distributed screen we own: hundreds of supplier companies who will never pay us form their whole impression of ZenoSource here. Note from the competitive recon — **SourceDay already markets `"No login", interactive emails`**, so the differentiator is not that it exists, it's that ours is conspicuously better.

- [x] **`From: Acme Manufacturing via ZenoSource`, `Reply-To:` the named buyer.** Two header fields; the highest leverage-to-effort item in either review. Suppliers ignore no-reply automation and answer humans.
- [x] **Subject carries the commitment, not a count**: `Acme Manufacturing needs a date on P-10418 — 500 EA SKU-1001`. Preheader: `Tap once to confirm. No account, no password.` Today it's `2 open items with Acme Manufacturing` over byte-identical plain-text lines.
- [x] **Speakable claim code** (`7QK2-M4RD`) anywhere a human reads it; the secret stays in the href. Today's 64-hex link looks like malware, can't be read down a phone, and is why the email detail view overflows a phone by 83%.
- [x] **The reminder email becomes a designed artifact** carrying document number, supplier, line summary and dates, with per-item deep links. It *is* the product for suppliers.
- [x] **`/a/{token}` leads with the buyer's name**, the document number and the need-by, and one full-width button carrying the actual commitment: `Confirm — 500 EA by 14 Aug`. Today it names the recipient, not the asker, and shows no number and no date.
- [x] **Per-line confirm with a promise date** — [data-model.md](data-model.md#purchaseorderline) says `promise_date` is "set once acknowledged" and the form never asks, so the happy path leaves it null forever.
- [x] **Supplier propose-change** — per-line qty/price/date counter-proposals. The `proposed*` columns and `PO_REVIEW_CHANGE_PROPOSAL` already exist; the buyer's accept/reject UI shipped with no producer, so the flagship collaboration feature is half-built.
- [x] **External quote submission** — token-scoped per-line price + lead time + a Decline option; first submission moves `SENT → RESPONSES_OPEN`, currently unreachable through the app. Today the RFQ view reads "Submit your quote" above an **Acknowledge** button that resolves the action item having supplied nothing. Largest single gap in the product, and it unblocks `RFQ_AWARD_DECISION` and the entire quote-comparison surface.
- [x] **A receipt, written in the third person** — *"Sam Supplier confirmed 500 EA of SKU-1001 for delivery 14 Aug"* — because it gets forwarded to the supplier's own boss. Plus `Add to calendar (14 Aug)` as an `.ics` carrying the promise date: one route, and it puts the buyer's need-by into a shop foreman's calendar.
- [x] Fix the post-response copy — reopening a resolved link currently tells a supplier who just succeeded to "ask your contact to resend the link." Make the action-label map exhaustive, and delete the second conflicting copy of `ACTION_LABELS` in [a/[token]/page.tsx:6](../apps/platform/src/app/a/[token]/page.tsx:6) whose own comment claims it exists so wording never drifts.
- [x] **Send the action link transactionally on PO issue and RFQ send**, and record what was sent when. Today the only email producer is the digest job, so issuing a PO sends the supplier nothing. *(Moved here from Phase 1a's notification loop — the provider and scheduler stay there; this is the product half.)*
- [x] View/resend the external link from the buyer side, and render the real HTML email in a 390px phone frame at `/dashboard/emails`. When a supplier says "I never got it," that screen ends the argument.
- [x] One brand on the external surface — the PO view's primary button is indigo and the RFQ view's is black, one route apart.

### Wave 4 — No unowned states

Every item here is a state that resolves to no owned action, which is the modeling bug [product.md](product.md) names. This is the wave that makes the product's central claim true.

- [x] **PO receive/close**: `IN_PROGRESS`/`FULFILLED`/`CLOSED` are reachable only via seed data. A buyer "mark received" flow (per line, recording `receivedAt` + received quantity) that rolls the header up when all lines are terminal. Keep the status filters — ERP-synced data legitimately holds these states.
- [x] `ACKNOWLEDGED`, `IN_PROGRESS` and `FULFILLED` POs currently offer no action but Duplicate.
- [x] **`REJECTED` needs a revise-and-reissue exit** — today the only options are Cancel or an unlinked Duplicate that doesn't resolve the review item, so a buyer who responds the intended way gets reminded forever.
- [x] **RFQ draft send/edit/add-supplier/delete**; duplicating an RFQ currently drops the invited suppliers, producing a draft that can never be sent.
- [x] **Award → PO handoff** with `RFQ_RAISE_PO_FROM_AWARD` as a real action item, and an award that states its consequence *including what doesn't happen*: *"This closes the RFQ for Northline and Titan. It does not create a PO — you'll raise that next."*
- [x] **Award needs line coverage** — it's per-quote and all-or-nothing, a no-bid cell renders as a bare em-dash indistinguishable from "nothing here", and nothing warns when the winning quote didn't bid every line. Add per-supplier quote totals and low-bid emphasis while in there.
- [x] **RFQ quote deadline** — without it the response window is unbounded and there is nothing to escalate against.
- [x] RFQ list: one 10px square per invitee, filled at *that invitee's* own dwell, hollow once they respond.
- [x] Draft delete for POs and RFQs — abandoning a mistaken draft currently means cancelling it into the list forever.
- [x] **Add the missing `ActionItemType`s** — PO `DRAFT`, `ACKNOWLEDGED`/`IN_PROGRESS`, `FULFILLED`; RFQ `DRAFT`, `AWARDED` — each landing with the producer above, or an explicit note here naming the states we deliberately don't chase. *(Moved from Phase 1a: the type and its producer land together.)*
- [x] **The possession strip** — a 28px proportional bar under the PO title showing the order's whole life, `[1d draft][0.2d you issued][11d them][2d you, open]`. **Sequenced here deliberately**: it stitches `ActionItem` history into contiguous segments, so it is only honest once every transition mints an item. Until then it would draw gaps it can't explain.

### Wave 5 — Reference data and the long tail

Everything here is append-only today, which means every mistake is permanent.

- [x] Suppliers: edit + deactivate (the `INACTIVE` badge renders but nothing sets it), contact edit/remove (reminders otherwise go to dead addresses forever), create a real `SupplierContact` from the primary-contact fields at creation, and return the duplicate-email violation as a form error rather than a crash.
- [x] Price lists: edit/delete for items and breaks, effective-date editing + `from <= to` validation + a computed current/expired indicator, list deletion, duplicate-guards on item number and break min-quantity. Stepped schedule with computed `QTY TO` (`1–249 / 250–999 / 1,000–—`) so "what does SKU-2050 cost today?" has an answer.
- [x] Locations: edit + deactivate, unassign users (assignment is one-way — an access-control gap, not a convenience gap), and expose the street-address/postal columns the form omits.
- [x] **Team management**: no invite/create user, role change, deactivate, password change or reset — a buyer org cannot onboard its second procurement person, and a forgotten password is permanent lockout.
- [x] Consistent reference-data governance: a MEMBER can create suppliers and price lists but not locations, and the owner-only "Add location" form renders in full and only refuses on submit.
- [x] Number inputs accept nonsense silently — precision truncated without warning, zero accepted.
- [x] **The voice pass.** Adopt the five rules in [test1a-2.md](test1a-2.md#the-voice) and rewrite all 58 strings. `Save RFQ` → `Send to 3 suppliers` (that button emails three suppliers and opens three external action items; "Save" is a lie of omission). `"Only draft POs can be edited directly."` → `"This PO is already with the supplier. Issued POs change by agreement, not by edit."` Name the chase **"the chase"**.

---

### What shipped

**Wave 1 — the spine.** Sign-out actually signs you out, and an E2E spec asserts the cookie is gone rather than the redirect. Every date now goes through one formatter that forces UTC, closing the thirteen call sites that rendered a typed 18 Aug as 17 Aug; `src/lib/format.test.ts` pins it. Forms echo their input back and report per-field errors keyed by the control's own `name`, so one missing Location costs a keystroke instead of thirty-five fields. Every control gets an `id`. Irreversible actions sit behind a confirm that names the consequence, and `SubmitButton` reads its pending state from `useFormStatus()` rather than a prop — the seven buttons that were missing it were precisely the seven that mattered. Arial is gone. The token set is in `globals.css` with the five-step oxidation ramp, cobalt for whose court, and verdigris for settled; dark mode declares `color-scheme` at last. No coloured status badges and no indigo anywhere. Document numbers are one atomic tenant sequence (`P-10418`, `Q-10422`, `L-10007`) with a race test. Waiting-longest-first is the only sort, and the `Sort` dropdown is deleted.

**Wave 2 — the work made visible.** `/dashboard` leads with **"You owe 37. They owe 34."** at display size, splits into your court and their court, and ranks by dwell × value rather than dwell. `Chase all N` aggregates by recipient with a 24-hour server-side cooldown. Lists are ledgers: hairlines, mono figures, and a `WHAT'S OWED` sentence instead of a status noun. Search covers document number, supplier, part and description; filters apply on change; pagination is real. PO detail is a document, with the change proposal as a diff whose heaviest row is extended value. There are `loading` / `error` / `not-found` / `global-error` boundaries where there were none. The five-line cap is gone. Unit prices pre-fill from the matching price break *for the quantity typed*, and flag an override as `off schedule +403%`.

**Wave 3 — the supplier surface.** `From: Acme Manufacturing via ZenoSource`, `Reply-To:` a named human. The subject carries the commitment (`Acme Manufacturing needs a date on P-10418 — 500 EA SKU-1001`) and the body is a designed HTML artifact with a speakable claim code. `/a/{token}` leads with the buyer, the number and the date, over one full-width button that says `Confirm — 500 EA by 10 Aug 2026`. Supplier propose-change and external quote submission both exist, which closes the largest gap in the product: `RESPONSES_OPEN` and the entire quote-comparison surface were unreachable from inside the app. Receipts are written in the third person because they get forwarded, and carry an `.ics`.

**Wave 4 — no unowned states.** Receive/close, revise-and-reissue, RFQ send/add-supplier/delete, award → PO handoff, per-invitee dwell squares, quote deadlines, draft delete. `src/lib/lifecycle.test.ts` asserts that every status either mints an action item or appears on `UNCHASED_STATUSES` with a written reason — the product's central claim, made executable. The possession strip draws where an order's time went.

**Wave 5 — reference data.** Suppliers, contacts, price lists, breaks and locations are all editable and deactivatable; team management exists at all, including a hand-over that moves a departing person's open items and location access to a named successor. Numbers are bounded. The voice pass landed with the screens rather than after them.

**Three bugs found while building, not by the audit:**

1. *A $12 trillion purchase order* in the seeded dev database — unbounded quantity × price — which surfaced as a `numeric field overflow` the first time a migration tried to sum order values. Inputs are bounded now, and `totalValue` is sized so it cannot overflow for in-bounds input.
2. *Blank spare rows counted as filled-in ones.* The new-line parser treated a row as touched if any field had content — and every empty row pre-fills `uom: "EA"`, so a one-line order with two spare rows failed validation with six errors. Caught by an E2E spec, not by review.
3. *One click declined an RFQ outright.* React reuses the same `<button>` DOM node when a conditional only swaps its label and type, so mousedown landed on the trigger and mouseup on the freshly-`type="submit"` element — skipping the confirmation the supplier never saw. Replaced with a native `<details>`, which also means that path now works before hydration, on the one surface that most needs to.

**One trade-off, recorded so it isn't mistaken for a regression:** a *nested* not-found boundary renders inside the already-streamed dashboard layout, so a scope-denied record now returns HTTP 200 carrying the designed "Nothing here." page rather than a bare framework 404. Nothing about the record is disclosed — the E2E specs assert on that directly — but if a 404 status ever matters, the fix is to move the boundary to the root and lose the shell.

---

### Cut

Proposed and deliberately rejected, so they don't come back:

**Theme pickers · density toggles · saved views · column choosers · custom fields · a settings page · per-user preferences · the `Sort` dropdown · the `Apply` button · streaks, badges, confetti or any productivity scoreboard about the user.** [product.md](product.md) says configurability is a cost; creative edge means stronger opinion and *fewer* choices. The competitive read that justifies this: SourceDay needs saved views because their queue has no opinion about what matters.

Also cut from the winning design direction itself, on judges' advice: empty-band scaffolding (a discipline scoreboard in a typographic costume), a 44px `BOARD CLEAR` ceremony (a state a real tenant hits twice a quarter), the card-flip animation (a returning 2013 idiom), serif type anywhere, and showing `chased 9×` **to the supplier** — that disciplines the side whose goodwill we need in November. Keep the count on the buyer's screen.

Keyboard: ship `J`/`K`/`Enter` and `/` for search. Defer the full `A R N Esc` layer until the actions have real pending states — a shortcut that silently fires an unacknowledged server action is worse than no shortcut.

### Deferred past Phase 1b

Real gaps, each a phase of its own. Recorded so they aren't rediscovered:

- **Attachments** on POs and RFQs — table stakes in this market, and a schema plus storage decision.
- **Import/export** and **bulk actions** on lists.
- **Event notification** — the app only ever sends a periodic digest of what's still open; nothing tells a buyer *when* a supplier acts.
- **Optimistic-locking UI** — two buyers editing one draft PO silently overwrite each other. Partly addressed by Phase 1a's reporting-schema work.
- **A settings/admin surface.**
- **The team board** — the manager persona owns no action items and signs in to an empty screen. It's the same query minus the `internalOwnerId` filter, and it belongs with the reporting scorecards in Phase 1a rather than here.

### Known holes in this plan

Surfaced by the judges attacking the proposals. Not scoped above, and each is real:

- **Money is never aggregated** — no `$1.4M issued and unacknowledged`, no `$310K sitting on a supplier over two weeks`. That's the CFO sentence and the renewal sentence. The dwell × value law above is the minimum version; the aggregate view isn't scoped.
- **The multi-line PO is undrawn.** Every mockup in both reviews shows a 1–3 line order; real repeat orders run 12–40 lines with mixed statuses, and `PurchaseOrderLine.status` is where the chase actually lives.
- **There is nowhere to say anything to a supplier.** The moment a conversation doesn't fit three buttons the buyer leaves for Outlook and the drift this product exists to prevent restarts off-platform. Needs one note field on the action item, visible to both sides, riding along in the chase email — not a chat product.
- **Nothing survives the second person** — no handoff, no reassignment, no "Casey's out." The common failure in a 200-person shop is an item owned by someone who left, with the board looking fine to everyone else.
- **Nobody designed the failure of the premise.** Chased five times over 23 days — *now what?* A chase with no terminal branch is the doctrine's own modeling bug, one level up.
- **Nobody designed the Epicor-connected product**, and by our own doctrine a stale ERP connection is an open action owned by someone, so it belongs on the board.
- **The number that renews the contract**: *"84% of your suppliers responded without a second chase, up from 61%"* — computable from `ActionItem` history, no ML, no new tables. Belongs with the reporting scorecards.


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
- **External supplier accounts: deferred** (2026-07-28) — no supplier password login or portal in v1; the scoped action-view links plus reminder digests are the entire external surface. [architecture.md](architecture.md), [product.md](product.md), and the root CLAUDE.md are amended accordingly, and the unused `SupplierContact.passwordHash` column is dropped. Revisit no earlier than Phase 5's security review.
- **Email until a provider is chosen: the dev mailbox** (2026-07-28) — while `EMAIL_PROVIDER` is unset, `getEmailSender()` captures outbound email to the database and `/dashboard/emails` (internal sign-in required; "Emails (dev)" in the nav) renders it, with clickable `/a/{token}` action links and a button to run the reminder job on demand. Setting `EMAIL_PROVIDER` hides the nav link, 404s the page, and disables the capture path — currently by throwing, since no real sender is implemented yet.

## Open questions for you

- **Pricing strategy**: still open by design. For now the homepage pricing page ships with a placeholder ("Coming soon" / "Call for pricing") rather than real numbers — revisit whether the eventual model is flat SaaS tiers, custom/negotiated like SourceDay (~$30K–500K/yr), or plan-based like Axya.
- **ERP #2 / IdP #2**: still open. Even a rough target for each would help validate that the capability-registry and IdP-broker abstractions in [docs/architecture.md](architecture.md) and [docs/integrations.md](integrations.md) generalize past a single example instead of quietly being Epicor/Okta-shaped.
- **Data-model gaps surfaced while drafting the schema**: the exact RFQ status enum, whether an awarded RFQ auto-creates a PurchaseOrder, and the Item/part identity strategy (denormalized strings vs. a dedicated `Item` entity). Full detail: [docs/data-model.md#open-questions-this-doc-surfaces](data-model.md#open-questions-this-doc-surfaces).
- **Hosting/scheduling platform + email provider**: not chosen yet. The dev mailbox (see [Decided](#decided)) unblocks development and demos — outbound email is captured in-app with clickable action links — but real delivery still needs a provider behind the existing `EmailSender` interface, and the daily digest still needs a scheduler to trigger it. `npm run send-reminders` (or the button on `/dashboard/emails`) runs the job on demand in the meantime.
