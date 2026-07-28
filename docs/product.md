# Product: vision, market, feature set

## Why this market

Manufacturers running direct-materials procurement through phone calls, email, faxes, and spreadsheets are the target buyer — the same customer SourceDay and Axya sell to. The pain isn't a missing feature, it's that the ERP's PO/pricing data drifts from reality the moment a supplier confirms (or fails to confirm) a date, quantity, or price, and nothing forces that drift back into a single controlled record.

## Competitive landscape

### SourceDay (sourceday.com)

- Positions as an "AI-driven supplier portal" for **direct-materials** procurement at manufacturers/distributors (medical devices, aerospace/defense, electronics, industrial machinery). Tagline: "Finally, PO data you can trust."
- Core loop: PO Collaboration (line/release-level PO tracking through splits, move-ins, move-outs) + a supplier portal explicitly marketed as "not a document repository" but a controlled environment where suppliers accept/reject/counter-propose changes to qty, price, and date.
- Named AI agents: Supplier Activation Agent, PO Delivery Agent, Open Order Chaser, PO Change Agent — plus supplier scorecards, an item/price-trend hub, and shipment visibility.
- ERP-first, bidirectional sync (pulls POs, pushes supplier-driven changes back), certified integrations with Epicor, NetSuite, Acumatica, Infor.
- Pricing is custom/negotiated, no public list — third-party transaction data puts typical deals around $21K–$530K/yr (~$190K/yr average).
- **Epicor has embedded SourceDay natively into Kinetic's supply-chain suite** (marketed on Epicor's own site, part of Epicor's "Cognitive ERP" push). This matters strategically: building the Epicor integration means competing against an incumbent with privileged, native placement inside the ERP itself — not just building against a neutral open API. Factor this into how the Epicor integration is positioned and sold, and consider whether multi-ERP breadth becomes a faster differentiator than going deep on Epicor alone.

### Axya (axya.co, formerly GRAD4)

- Positions as a "procurement orchestration layer" laid over existing ERPs, built specifically for **manufacturing sourcing** (aerospace, transportation, mining, industrial equipment) rather than generic enterprise procurement governance.
- Core loop is RFQ-first: supplier onboarding/targeting → centralized RFQ distribution → side-by-side quote comparison → award → PO tracking with automated confirmations and milestone reminders. Includes OCR to extract data from supplier PDFs/Excel/images, a built-in 20,000+ supplier directory, and free supplier-side access.
- ERP integrations: SAP (S/4HANA, ECC), Sage X3, Acumatica — bidirectional (POs sync out, supplier confirmations sync back).
- Deliberately narrow: normalizes supplier input (email, portal, EDI, PDF) into fixed status states (win/loss, confirmed qty/date) regardless of channel, built around one fixed sequence (RFQ → supplier selection → PO follow-up) rather than configurable workflows.
- Pricing is plan-based and not public.

### Positioning takeaway

Both competitors already run on the same thesis this project is built on: **narrow the workflow, don't widen the configuration surface.** Neither is winning on breadth of features — they win by forcing supplier chaos into one controlled state machine. ZenoSource's differentiation has to come from somewhere else: integration breadth (starting with Epicor, but not stopping there), pricing/accessibility for the mid-market, or execution quality — not from being more configurable.

## Feature set (v1 scope)

- **Purchase Orders** — creation/import, defined lifecycle (draft → issued → acknowledged → in-progress → fulfilled/closed), with supplier rejection and buyer cancellation as explicit exits at any point before fulfillment. Line and release-level tracking, supplier-driven change proposals (qty/price/date) with buyer accept/reject.
- **RFQs** — create, distribute to suppliers, collect and compare quotes, award.
- **Price Lists with price breaks** — per-supplier, per-item pricing with quantity-threshold breaks and effective dates.
- **PO Suggestions** — integration-gated (see [docs/architecture.md](architecture.md)); v1 sources these from a connected ERP's own MRP output (Epicor) rather than generating them internally.
- **Supplier collaboration** — external user accounts scoped to the POs/RFQs they're invited into, acknowledgment/confirmation flows, status visibility.
- **Reporting** — buyer scorecards, supplier scorecards, and other operational reporting surfaces, built on top of the action-item/state-transition history rather than as a bolted-on analytics layer. Expect this list to grow past these two.

### Explicit non-goals for v1

- No indirect/services spend procurement (contracts, invoicing, payments) — direct-materials manufacturing procurement only, matching both competitors' focus.
- No independent MRP/forecasting engine — PO Suggestions ride on a connected ERP's engine until there's a reason to build ZenoSource's own.
- No general-purpose workflow builder or custom-field system — see philosophy below.

## Product philosophy: opinionated by design

ZenoSource is **process management software, not a system of record.** A system of record just stores the current state of a PO or RFQ; ZenoSource is responsible for driving that state to closure. The restrictive posture below is in service of that — not a v1-scope limitation to relax later.

- **Every state is an open action, owned by someone.** A PO or RFQ sitting in a given state is never just a status to observe — it resolves to a specific action owned by whoever needs to act next, buyer or supplier. "Awaiting supplier acknowledgment" means the supplier owes an acknowledgment; "awaiting buyer approval" means the buyer owes a decision. If a state doesn't resolve to a clear next action and a clear owner, it isn't modeled correctly. See [docs/architecture.md](architecture.md) for how action items are represented as first-class objects.
- **Open action items get chased automatically.** Both internal and external users get reminders on their open action items on a recurring cadence, daily by default, by email in v1. Inside the app, open items are the first thing a user sees on sign-in, with a badge showing how many are outstanding — the dashboard carries this job as much as the email does. This is the actual mechanism that closes the gap both competitors sell against — an unacknowledged PO or an unanswered RFQ is a liability specifically because nothing was chasing it.
- **Minimizing external friction is part of being opinionated, not a contradiction of it.** The restrictive posture applies to how the buyer-side workflow is shaped — not to how hard it is for a supplier to respond. External users should be able to resolve an open action item (acknowledge a PO, answer an RFQ, confirm a date) as directly as clicking straight through from the reminder email into a scoped action view, with no account creation and no login required. If they have access to the email, that's sufficient proof they're the right contact to respond. Full password-based platform login stays available for suppliers who want persistent access to everything they owe, but it should never be a precondition for clearing a single action item. See [docs/architecture.md](architecture.md) for how this fits the auth model.
- **Fixed state machines, not configurable statuses.** A PO or RFQ has one defined lifecycle. Tenants don't get to invent new statuses or skip steps.
- **One way to do a thing.** Where SourceDay and Axya both succeed by collapsing many supplier communication channels into one controlled process, ZenoSource should collapse many buyer processes into one prescribed flow rather than accommodating each customer's existing (broken) process.
- **Configurability is a cost, not a feature.** Every proposed setting or custom field should be treated as a regression on the core bet until proven otherwise — it's the opposite default from typical enterprise software, and it should stay that way as the product grows.
