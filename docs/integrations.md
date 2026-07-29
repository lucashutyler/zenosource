# Integrations

General model (capability registry, tenant activation) lives in [docs/architecture.md](architecture.md). This doc covers the two v1 integrations concretely, plus the pattern for adding another one later.

## Epicor (ERP)

- **Surface**: Kinetic REST API v2 (OData v4-compliant), covering Business Objects (BOs), Business Activity Queries (BAQs), and Epicor Functions (EFx — custom server-side logic exposed as REST endpoints).
- **Auth is dual-layer**: every call needs (a) an API Key (from Security/API Key Maintenance, tied to an Access Scope) *and* (b) an identity credential (Basic Auth, or a Bearer/OAuth2 token via `TokenResource.svc`, or Azure AD/Epicor IdP depending on the customer's config). Missing either fails differently — the connection-health check and onboarding flow need to distinguish the two failure modes, not report one generic "auth failed."
- **Relevant BOs**:
  - `POHeader` / `PODetail` / `PORel` — purchase orders, lines, and releases.
  - `POReqSvc` — requisitions.
  - `POSuggSvc` — PO suggestions.
  - `VendorSvc` — supplier master data.
  - `VendPartSvc` — vendor/part cross-reference and pricing. There is no clean, single "PriceList" service in Epicor — pricing lives on the vendor-part relationship, and integrators consistently land on `VendPartSvc` rather than the more ambiguous `PriceLstSvc`. Expect to reconcile this into ZenoSource's own `PriceList`/`PriceBreak` shape rather than mirroring Epicor's naming.
- **PO Suggestions pipeline** (why `po_suggestions` is read-only from ZenoSource's side): demand (sales orders/forecasts/jobs) → MRP run → `POReqSvc` requisition → `POSuggSvc` suggestion → approved into a firm PO. Suggestions **cannot be created directly via REST** — write attempts fail (e.g. "Suggestion is no longer valid"). ZenoSource reads suggestions, lets a buyer act on them, and pushes the resulting decision back through Epicor's requisition/approval path rather than attempting to write a suggestion directly. See [docs/architecture.md](architecture.md) for how this constrains the data-boundary model.
- **Write-back pattern**: prefer curated **Updatable BAQs** as the integration surface for anything beyond simple reads, rather than calling raw BOs directly. This is the common ISV pattern for Epicor integrations — it lets the integration shape a purpose-built view (e.g., "open PO lines needing supplier confirmation") and write through it, avoiding brittle direct-BO permission and business-logic pitfalls.
- **Competitive context**: Epicor has embedded SourceDay natively into Kinetic's supply-chain suite as part of Epicor's "Cognitive ERP" push — it's marketed on Epicor's own site as a built-in capability, not a third-party add-on. The Epicor integration is being built against an incumbent with privileged platform placement, not a neutral playing field. See [docs/product.md](product.md) for the positioning implication.

## Okta (IdP)

- **Support both OIDC and SAML from day one.** The customer's Okta admin picks the protocol per app instance, not ZenoSource — enterprise buyers often just hand over SAML metadata XML, and there's no way to standardize that away.
- **Multi-tenancy shape**: the real-world norm is one Okta org per customer. Don't build against Okta's own internal multi-tenancy tooling (Identity Engine, Org2Org) — that's for Okta managing its own orgs, not for how a third-party vendor federates with many separate customer orgs. Instead: store per-tenant IdP config (SAML cert/metadata, or OIDC issuer + client_id), resolve the tenant by email domain or subdomain, then validate the assertion/token against that tenant's stored config.
- **Provisioning**: SCIM 2.0 against ZenoSource's own `/Users` and `/Groups` endpoints — create, attribute updates, deactivate on offboarding, and Group Push for role/group sync. Each tenant's Okta connection gets its own SCIM bearer token, and that token *is* the tenant boundary: a bug that lets one tenant's SCIM token touch another tenant's users is a severe multi-tenancy breach, not just a permissions bug.
- **Internal vs. external users**: internal (buyer-org) users authenticate via the tenant's federated Okta (SSO). External (supplier) users have no Okta involvement at all — in v1 they act exclusively through scoped, no-login action-view links; persistent app-native supplier accounts are deferred (see [docs/todo.md#decided](todo.md#decided)). Both paths — SSO sessions and scoped action-view grants — land behind one session/authorization layer so the rest of the platform is agnostic to which path a user came in through.
- **Design for a second IdP now, not later**: keep SSO/SCIM logic behind a protocol-agnostic broker — per-tenant connection config, tenant resolved *before* assertion/token validation, protocol differences abstracted below the business logic. This is the pattern dedicated auth-broker products use (SAML Jackson/Ory Polis, WorkOS, Frontegg, Scalekit). Building it this way from the start makes Entra ID or Google Workspace a config addition later instead of a rewrite of the auth path.

## Adding a new integration

1. Register it: `id`, `type` (`erp` | `idp` | ...), declared `capabilities[]`.
2. Implement it as its own subproject under `integrations/<type>/<name>/`.
3. Map its native data/protocol to ZenoSource's canonical entities — don't leak vendor-specific shapes (Epicor's BO names, Okta's SCIM schema, etc.) into core platform code.
4. Document, in this file, what capability it provides and what capability (if any) it hard-requires from elsewhere.
