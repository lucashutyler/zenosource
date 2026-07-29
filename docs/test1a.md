# test1a — UX/UI user-testing report

Browser-driven user testing of `apps/platform` at the close of [Phase 1a](todo.md#phase-1a--close-out-the-core-loop-appsplatform), run 2026-07-28. This is the input document for [Phase 1b](todo.md#phase-1b--the-ledger-uxui-appsplatform), which is scoped directly from it.

Phase 1 built the surface. Phase 1a made the core loop *correct*. This pass asks a different question: **can a real buyer and a real supplier actually use it?** The answer is that the state machine is sound and the data model is right, but the interface on top of it is a scaffold — it withholds the information procurement runs on (document numbers, dates, totals), destroys work on the most common mistake, and shows suppliers a screen they cannot act on.

## Method

Twelve independent review passes, then adversarial verification of every claim.

**Task-based user testing** — six personas, each driving a real Chromium session against the running app, doing a named job rather than clicking around:

| Persona | Job |
|---|---|
| Dana, buyer | Place a repeat 3-line PO, issue it, find it again a day later, answer a supplier's phone call about SKU-2050 |
| Priya, sourcing lead | Run an RFQ from creation through quote comparison to award, then convert it |
| Sam, supplier rep | Respond to a reminder email from an iPhone, with no account, in under 20 seconds |
| Marcus, procurement manager | Answer "what's on fire and whose fault is it?" from the dashboard |
| Casey, MEMBER role | Work inside a restricted location scope; sign in, fail to sign in, hit denied records |
| Robin, procurement ops | Maintain suppliers, contacts, locations and negotiated price lists |

**Cross-cutting audits** — visual design system, accessibility (WCAG 2.2 AA), responsive/mobile at 390/820/1440, content and microcopy, state coverage (loading/empty/error/denied/overflow), plus a completeness critic asking what the other eleven passes missed.

**Verification** — every finding was handed to a separate agent instructed to *refute* it against the running app and the source, and to check it against `docs/todo.md` so Phase 1b would not silently re-list Phase 1a scope. The most severe claims were then re-confirmed first-hand.

**Result**: 187 raw findings → 2 refuted → **185 surviving** (8 blocker, 52 high, 103 medium, 22 low). There is heavy overlap between passes — the form-wipe defect was independently found by four agents, the label defect by three — which is corroboration, not inflation. **125 map onto bullets Phase 1a already tracks; 60 are new.**

### Environment caveat — read this before re-running anything

The first round ran against a `next dev` process that had been up for ten hours and had gone stale: its in-memory Prisma client still referenced the `SupplierContact.passwordHash` column that Phase 1a dropped via `db push`. Three agents reported HTTP 500 on `/dashboard/emails`, every supplier detail page, every `/a/{token}` route, and RFQ creation, and two rated it a blocker.

**None of it is real.** A clean server returns 200 on all of them; every scenario re-ran successfully. Both are recorded under [Refuted](#refuted-claims). This is worth knowing for two reasons: it is what the [migration-history debt](todo.md#carried-over-infrastructure-debt) actually feels like in practice, and any future agent-driven review should start its own server rather than trusting a long-lived one.

---

## Part 1 — The eight defects that block real use

Confirmed first-hand on a clean server, in this order of severity.

### 1. Sign out does not sign you out

Open the user menu, click **Sign out**: the page stays on `/dashboard`, the `session` cookie is still set, and `/dashboard` still returns 200. You are never signed out.

The cause is in [user-menu.tsx:36](../apps/platform/src/app/dashboard/user-menu.tsx:36) — the flyout's container has `onClick={() => setOpen(false)}`, and the Sign out `<form>` is a child of it. The click event bubbles to the container before the form's `submit` event fires, React flushes the state update discretely, and the form unmounts before the submission is dispatched. The action never runs.

On a shared plant-floor workstation this is a real security exposure, not a nit. It also makes the "browser Back shows the previous user's PO list" finding moot — there is no previous user, the session never ended.

### 2. Every user-entered date renders one day early

Typed a need-by of `2026-08-18`; Postgres stores `2026-08-18 00:00:00`; the RFQ detail page renders **8/17/2026**. Reproduced twice more with different dates.

Write path parses `new Date("2026-08-18")` → UTC midnight; read path calls `.toLocaleDateString()` with no `timeZone`, in a server running `America/Los_Angeles`. Every one of the 13 `.toLocaleDateString()` call sites is affected, in any timezone west of UTC.

This is a correctness bug wearing a formatting bug's clothes. A supplier who reads a need-by one day early on the external view ships to the wrong date, and the app is the thing that told them wrong. It is *not* covered by Phase 1a's "one money/date/qty formatter module" bullet, which is framed as a consistency cleanup.

### 3. A validation error destroys the entire form

On `/dashboard/purchase-orders/new`, fill the supplier and three lines (~15 fields), leave one Location at its default `—`, submit. You get one red line — `Line 1: Invalid input` — and **every field comes back blank**, including the supplier select and the dates.

[po-form.tsx](../apps/platform/src/app/dashboard/purchase-orders/po-form.tsx) seeds `defaultValue` from props only; React resets uncontrolled inputs after a form action, and nothing echoes the submitted `FormData` back. Every server-action form in the app has the same shape, so this is app-wide, not PO-specific.

For a buyer placing 15–30 POs a week this is the difference between a tool and a punishment, and it trains people to enter one-line POs to limit the blast radius — which fragments orders in the ERP, the exact problem the product exists to solve.

### 4. Every validation error says the same thing

The only message the PO and RFQ forms can produce is `Line N: Invalid input`. It never names the field. Worse, Location is the one required field on a line that is *not* marked required, while genuinely optional fields elsewhere are explicitly labelled `(optional)` — so the user's most reasonable guess about what went wrong is the wrong one.

### 5. The supplier's RFQ link cannot be used to quote

`/a/{token}` for an `RFQ_SUBMIT_QUOTE` item renders a heading that says **"Submit your quote"** above a single black button labelled **"Acknowledge"**. No RFQ lines, no quantities, no need-by, no price fields, no deadline, no decline option. Clicking it silently closes the request without a quote ever existing.

I looked at this on an iPhone viewport myself. It is the screen the product's entire external differentiation rests on, and a supplier literally cannot do the thing the heading asks. Phase 1a tracks the missing quote-submission flow; what this pass adds is that the current fallback is worse than nothing, because it *resolves the action item* — the supplier is removed from the chase list having supplied nothing.

### 6. The external action view never says who is asking

The PO acknowledge view says: *"Requested from Sam Supplier at Precision Parts Co."* — it names the **supplier**, i.e. the recipient. The buyer organization's name appears nowhere. Neither does a PO number, a need-by date, or an order total.

Sam sells to 40 customers. This screen tells him one of them wants something acknowledged, and does not tell him which one, which order, or when it is due. The two most important fields for the acknowledge decision — who and when — are both absent.

### 7. Supplier reminder emails are indistinguishable lines

The external digest is plain text: one line per item reading `- Acknowledge purchase order: http://localhost:3000/a/<64-hex>`, with subject `2 open items with Acme Manufacturing`. Two open POs produce two byte-identical lines differing only in an opaque token. There is no PO number, no part, no quantity, no date ([reminders.ts:60-67](../apps/platform/src/lib/reminders.ts:60)).

The email *is* the supplier's aggregate view — that is the deliberate v1 decision in place of a portal. Right now it cannot perform that role.

### 8. The PO detail table forces a phone to scroll sideways

At 390×844 the PO line table pushes the layout viewport to 448px, so the whole document pans horizontally and the Location and Status columns render outside the app chrome. The fix already exists in this codebase — [rfqs/[id]/page.tsx:149](../apps/platform/src/app/dashboard/rfqs/[id]/page.tsx:149) wraps its comparison table in `overflow-x-auto`.

---

## Part 2 — Five systemic defects

Each of these is one root cause showing up on many screens. They are the highest-leverage things in Phase 1b.

**A purchase order has no identity.** `PurchaseOrder` has no number field. List rows and detail titles are the supplier name alone, so the PO list shows eight rows reading "Precision Parts Co." — the top two byte-identical. There is no search anywhere in the app. Answering "the supplier called about SKU-2050" required opening all 25 POs (23 seconds of page loads) and still returned 8 candidates across 5 suppliers, none of them citable back to the caller. Phase 1a tracks the numbering; it does not track search or a supplier filter.

**The interface withholds the numbers procurement runs on.** No PO total, no extended line price, no need-by column on the buyer's PO detail *or* the supplier's external view, no quote totals in the RFQ comparison grid. A 5-line PO's value requires five multiplications by hand. "What is overdue?" is unanswerable anywhere in the product — which is a doctrine failure, because chasing overdue work is the product's stated job.

**Terminal actions are one click, unlabelled, and unguarded.** Award, Close RFQ, Accept proposal and Reject proposal are plain grey secondary buttons that fire immediately with no confirmation and no consequence stated. They are also exactly the 7 `SubmitButton`s in the app with no `pending` prop wired — all in server components — so they have no disabled state and no visual acknowledgement either. Meanwhile the *most* visually dominant control on every live PO page is a solid red **Cancel PO**, the one thing a buyer least often wants.

**The app has no designed states.** There are zero `loading.tsx`, `error.tsx`, `not-found.tsx` or `global-error.tsx` files in the entire app. Navigation gives no feedback for up to a second. A scope-denied MEMBER and a genuinely missing record produce the same bare framework 404 with no way back. A server error drops the user out of the shell onto `This page couldn't load` plus an opaque digest. And only the root layout exports `metadata`, so all 23 routes share the browser tab title "ZenoSource".

**No form control in the application has a programmatic label.** 40 controls on `/dashboard/purchase-orders/new`; 0 with an `id`; 36 orphan `<label for=...>` pointing at nothing. `Field` renders `htmlFor={name}` but `Input`/`Select` never set a matching `id` ([ui.tsx:14-45](../apps/platform/src/components/ui.tsx:14)). Clicking a label does nothing; a screen reader announces nothing; five identical unheaded line groups give no way to tell line 3's Qty from line 4's. One fix in one file resolves it nearly everywhere — and the correct pattern is already used, once, on the RFQ supplier checkboxes.

---

## Part 3 — By surface

### Purchase orders
Draft → issue works and the state machine is honestly enforced (Edit only on DRAFT, no back door). Beyond that: no PO number, no totals, no dates rendered, hard 5-line cap with a silently-discarded 6th line, and a back-dated need-by accepted without comment then copied verbatim by Duplicate. `ACKNOWLEDGED`, `IN_PROGRESS` and `FULFILLED` POs offer no action but Duplicate — they are unowned dead ends, which contradicts the core doctrine. The change-proposal card shows only the proposed values, never the current ones, so a buyer approves a change without seeing what changed; accepting or rejecting then leaves no trace and never tells the supplier.

### RFQs
Creation and send work. Everything after is thin: a DRAFT RFQ can only be Duplicated or Closed — no send, no edit, no add-supplier, no delete. Duplicating drops the invited suppliers, producing a draft that can never be sent. There is no quote deadline in the UI or the schema. Award is per-quote and all-or-nothing, with a no-bid cell rendered as a bare em-dash indistinguishable from "nothing here", no coverage warning, no confirmation — and an AWARDED RFQ then offers only Duplicate, with nothing chasing the conversion to a PO. The comparison grid's structure is right (lines as rows, suppliers as columns); it lacks extended amounts, quote totals, and any low-bid or lead-time-vs-need-by signal.

### External supplier surface
Covered in Part 1 — items 5, 6, 7. Two additions. The acknowledge is header-level all-or-nothing: no per-line response, no promise date (which [data-model.md](data-model.md#purchaseorderline) says is "set once acknowledged"), no counter-proposal — so the flagship collaboration feature has no producer. And reopening a resolved link greets the supplier with error-worded copy telling them to *"ask your contact to resend the link"* after they have already successfully responded. The two external routes also disagree on brand colour: the PO view's primary button is indigo, the RFQ view's is black.

### Dashboard and navigation
The inbox is the best-executed thing in the product — rows carry entity, supplier, line and age; deep links land on the exact PO line with an indigo ring and *"← this is what your action item is about"*. But it is the *only* thing on the landing page, which is otherwise 66% empty and completely blank for a MEMBER, who then sees "Nothing open right now" while 15 in-scope POs sit in her list. Nothing answers "whose court is the ball in" — external-owned items are invisible to every internal user. There is no global search, no aria-current, no skip link, and nothing anywhere tells you which organization you are in, what your role is, or what your location scope is.

### Master data
Append-only across the board: suppliers, contacts, locations and price lists can be created but never edited or deactivated, so a fat-fingered price or a wrong contact email is permanent. The primary contact typed at supplier creation is not stored as a `SupplierContact`, so a freshly created supplier cannot be issued a PO until someone re-types the same person. Price lists accept duplicate item numbers (two contradictory prices for one part) and an `effectiveFrom` after `effectiveTo` without complaint, answer neither "is this in effect?" nor "what does SKU-2050 cost today?", and influence nothing when raising a PO — a line saved at $44 against a negotiated $8.755 drew no warning. The locations list is tenant-scoped but not location-scoped ([locations/page.tsx:9](../apps/platform/src/app/dashboard/locations/page.tsx:9)), so a MEMBER sees every location in the tenant.

### Visual design system
**The entire product renders in Arial.** [globals.css:25](../apps/platform/src/app/globals.css:25) sets `body { font-family: Arial, Helvetica, sans-serif }` — leftover `create-next-app` boilerplate — which overrides the two Geist webfonts that [layout.tsx](../apps/platform/src/app/layout.tsx) downloads on every page load and then discards. All Geist faces report status `unloaded`. One line to fix, and it changes the impression of the whole product.

There is also effectively no typographic hierarchy — the page `<h1>` is 18px and a section heading is 14px, the same size and weight as a table cell. Four badge tones carry nine PO statuses, collapsing distinctions the product is built on (`closed` grey sits beside `fulfilled` green). The PO work queue is 30 identical 60px cards with ~880px of dead horizontal space per row where a table belongs. Login is a hand-rolled black-button form sharing nothing with the app, `/about` drops out of the shell entirely, and the component library is bypassed in eight places. Dark mode coverage is genuinely near-complete, but no user can choose it — it follows the OS only — and `color-scheme` is never declared, so native control chrome stays light inside dark fields.

### Accessibility
Beyond the labels: form errors are neither announced (`role="alert"`) nor associated (`aria-describedby`) nor focused; state transitions announce nothing and destroy focus; the "needs your action" dot is colour-only with no text equivalent; there is no skip link past 10 chrome controls; the closed mobile drawer keeps nine links in the tab order; neither the flyout nor the drawer closes on Escape; and `text-zinc-500` fails AA contrast on every secondary line in dark mode. The foundations are better than the details — correct landmarks, one `<h1>` per page, real tables and lists, `aria-hidden` on every decorative icon, accurate `aria-label`s on all four icon-only nav buttons, and clean 200% zoom and 320px reflow.

### Responsive
Single-column surfaces are excellent on a phone with no mobile-specific code at all, and the drawer's three close paths all work. The failures are concentrated: the PO detail table (Part 1, item 8), the email detail view overflowing by 83% because the action-link URL cannot wrap, and tap targets — the hamburger and drawer-close buttons are **20×20px**, and the RFQ supplier-invite checkboxes are **13×13px**, making the control that decides who receives an RFQ the smallest target in the app. No text anywhere falls below 12px.

### Content
Terminology is consistent and correct ("supplier" never "vendor"; the PO lifecycle matches the data model), the concurrency messages are unusually honest — *"This PO already changed — someone beat you to it."* — and the contactless-supplier guard is the best error message in the product because it names the record, the cause and the fix. Against that: "Save RFQ" is the button that transmits an RFQ to suppliers, "Apply" is the button that filters a list, and the same action is called "Acknowledge purchase order" in the email and "Respond to this purchase order" on the page it opens, because [a/[token]/page.tsx:6](../apps/platform/src/app/a/[token]/page.tsx:6) defines a second, conflicting copy of the shared `ACTION_LABELS` map whose own comment claims it exists "so the wording never drifts".

---

## Part 4 — What already works

Worth protecting as Phase 1b rewrites these screens.

- **The inbox is right.** Enriched rows, precise deep links to the exact line, graceful degradation when a subject lookup fails, and a badge that agrees with the list on every check. Phase 1a's "inbox rows say what and where" bullet has substantially landed.
- **Concurrency is handled better than most v1s.** Atomic `updateMany` status guards on every internal transition *and* on the external token path, `tryResolveActionItem` against double-resolution, and user-facing copy that explains what actually happened.
- **Location scoping genuinely works** on the read paths — Casey sees 15 POs not 25, her Location dropdown omits Dallas rather than offering it and failing, and `?locationId=` intersects with her scope rather than replacing it.
- **The nav is restrained** — six work objects, no submenus, no settings tree. That is the product philosophy expressed as information architecture and it should be defended.
- **URL state is honest** — filters survive copy-paste into a fresh browser and browser Forward.
- **The explanatory subtitles teach the model** rather than labelling the screen: *"Every PO line ships to one of these. Users are assigned to the locations they manage."*
- **Dark mode is near-complete** — 34 surfaces rendered with no unreadable text and no white flashes.
- **The state machine is visibly restrictive** — Edit only on DRAFT, terminal statuses drop Cancel, no back door to editing an issued PO.

## Refuted claims

Recorded so they are not re-reported.

- **"Every `/a/{token}` link returns 500 — the entire supplier surface is down."** Dev-process artifact. See [the environment caveat](#environment-caveat--read-this-before-re-running-anything).
- **"Inviting any supplier on the New RFQ form returns 500 — sending an RFQ is impossible."** Same cause. Re-run on a clean server it succeeds: RFQ created, status `sent`, both invites created, two `RFQ_SUBMIT_QUOTE` action items written.

One more worth flagging: the black circular badge in the bottom-left of every screenshot is the Next.js dev-tools indicator, not a product bug — but it does sit on top of the sidebar collapse control.

## Relationship to Phase 1a

Phase 1a's own audit was rigorous and mostly still accurate — of 44 bullets, exactly one is stale (the inbox-context bullet, now substantially done) and no `[x]` was over-claimed. **125 of the 185 findings map onto bullets it already tracks.** Phase 1b does not re-open those; it absorbs the UX-flavoured ones and sequences them, and adds the 60 that are new.

The three sequencing dependencies that fall out of this pass:

1. **Document numbers come first.** PO/RFQ numbering gates the inbox, the list rows, search, the reminder emails and the external view — five other items each get worse if they land before it.
2. **The date bug and the form wipe are not cleanups.** They are correctness defects on the two most-used interactions in the product and should precede any cosmetic work.
3. **External quote submission is the largest single UX gap** and unblocks `RFQ_AWARD_DECISION`, the `RESPONSES_OPEN` state, and the entire quote-comparison surface, which is currently unreachable with app-generated data.

## Reproducing this

The dev database now contains records created during testing (48 POs, 19 RFQs, 9 suppliers, 5 price lists, 8 captured emails). `npm run seed` restores the clean demo state.

Screenshots and the raw per-agent finding sets are session-local under the scratchpad and are not checked in; everything load-bearing is quoted above with a `file:line` or a reproduction.
