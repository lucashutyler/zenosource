# ZenoSource

ZenoSource is a procurement platform for manufacturers, competing directly with **SourceDay** and **Axya**. It covers the buyer-side procurement workflow end to end: purchase orders, RFQs, price lists (with quantity price breaks), PO suggestions, and supplier collaboration.

Full context lives in `docs/`. This file stays short on purpose — read the linked doc before working in that area.

## Product philosophy

**Opinionated, almost restrictive — not a configurable toolkit.** Buyers and sourcing teams work through fixed, guided workflows: prescribed state machines for POs and RFQs, not open-ended custom fields or arbitrary statuses. This mirrors why the incumbents win — they normalize messy supplier communication (email, EDI, PDF, portal) into one controlled process instead of exposing raw flexibility.

**This is process management software, not a system of record.** Every state a PO or RFQ can be in resolves to an open action owned by someone — buyer or supplier — and open action items are chased with recurring reminders (daily by default) to both internal and external users. A status nobody is being reminded to act on is a modeling bug.

Every product decision should ask "does this add configurability we don't want" before "does this add power." Detail and competitive grounding: [docs/product.md](docs/product.md).

## Users

Two populations, one platform:
- **Internal users** — employees of the buyer organization (procurement, sourcing, ops). Authenticate via the buyer org's own IdP.
- **External users** — suppliers. Usually no enterprise IdP relationship with the buyer; they resolve action items straight from the reminder email with no login at all — the scoped action-view link is the entire v1 external surface. Persistent supplier accounts (password login, a supplier portal) are deliberately deferred; see [docs/todo.md](docs/todo.md#decided).

Internal users get **two doors, not a replacement**: a password, and — once their organization connects an identity provider — single sign-on. Federation never takes the password away, and a directory that deactivates somebody always hands their open work to somebody else. Both were forced by rules this codebase already enforces rather than chosen; [docs/todo.md](docs/todo.md) Phase 3 says which.

Third-party IdP support starts with **Okta** (OIDC + SAML, SCIM provisioning). Detail: [docs/integrations.md](docs/integrations.md#okta-idp).

## Integrations gate features

ZenoSource is built to be extensible: each integration declares the *capabilities* it provides, each feature declares the capability it needs, and a feature only lights up for a tenant once a connected integration supplies that capability. Example: **PO Suggestions** only appears once **Epicor** is connected, because Epicor's MRP engine is what generates suggestions — ZenoSource does not fabricate them independently. This capability-registry model is the core extensibility mechanism for the whole platform. Detail: [docs/architecture.md](docs/architecture.md).

## Initial integration targets

- **ERP**: Epicor (Kinetic) — [docs/integrations.md#epicor-erp](docs/integrations.md#epicor-erp)
- **IdP**: Okta (OIDC, SAML, SCIM 2.0) — [docs/integrations.md#okta-idp](docs/integrations.md#okta-idp)

## Comments

Minimal. Names carry the scope: a function, a variable, a test should say what it is without help, and a
test name should state the assertion it makes. Documents carry the program — `docs/` for the system, a
subproject's `CLAUDE.md` and `README.md` for that subproject, this file for what's true platform-wide.

A comment earns its place only when it records something no name can:

- **A decision whose opposite looks correct**, so nobody "fixes" it back into a regression.
- **A constraint from outside** — a vendor's behaviour, a specification's requirement, a framework's rule.

Everything else goes. Don't restate the line below, don't narrate how the code came to be written, and
don't leave the reasoning from a review or a bug hunt in the source. That belongs in the commit message,
or in `docs/todo.md` if it should outlive the commit.

## Repo structure (subprojects)

| Path | Purpose |
|---|---|
| `apps/homepage` | Marketing site — pricing, features, signup |
| `apps/platform` | The product — PO, RFQ, price lists, PO suggestions, supplier collaboration, internal + external auth |
| `integrations/erp/epicor` | First ERP integration |
| `integrations/idp/okta` | First IdP integration |
| `docs/` | Everything below |

Each subproject is independently deployable and free to choose its own language, framework, and tooling — there is no shared stack requirement. Once a subproject grows non-trivial, it should get its own `CLAUDE.md` scoped to it; this root file only covers what's true platform-wide.

## Docs

- [docs/product.md](docs/product.md) — vision, competitive landscape (SourceDay, Axya), v1 feature set, product philosophy in depth
- [docs/architecture.md](docs/architecture.md) — subproject layout, capability/feature-gating model, tenancy, data boundaries
- [docs/data-model.md](docs/data-model.md) — field-level schema for the canonical entities
- [docs/integrations.md](docs/integrations.md) — Epicor and Okta integration specifics, pattern for adding new integrations
- [docs/todo.md](docs/todo.md) — phased build plan and open questions for review
- [docs/test1a.md](docs/test1a.md) — UX/UI user-testing report on the Phase 1a build; the source Phase 1b is scoped from
- [docs/test1a-2.md](docs/test1a-2.md) — the design-direction companion to the above: what the product should *feel* like; merged into Phase 1b alongside test1a.md
