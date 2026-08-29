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
- **Built** (2026-08-19, `integrations/erp/epicor`): a zero-dependency TypeScript connector providing `po_sync`, `po_suggestions`, `supplier_sync` and `price_list_sync`. It hard-requires nothing from elsewhere. Not yet run against a live Kinetic instance — service names are documented and stable, but entity-set names and column spellings vary by version and customization, so all of them are per-connection overridable or read through candidate lists. Detail and adaptation notes: [integrations/erp/epicor/README.md](../integrations/erp/epicor/README.md).
- **Competitive context**: Epicor has embedded SourceDay natively into Kinetic's supply-chain suite as part of Epicor's "Cognitive ERP" push — it's marketed on Epicor's own site as a built-in capability, not a third-party add-on. The Epicor integration is being built against an incumbent with privileged platform placement, not a neutral playing field. See [docs/product.md](product.md) for the positioning implication.

## Okta (IdP)

**Built in Phase 3 (2026-08-22), not yet validated against a real Okta org.** The design notes below
are unchanged; what follows them is what was built, and the honest half.

- **Support both OIDC and SAML from day one.** The customer's Okta admin picks the protocol per app instance, not ZenoSource — enterprise buyers often just hand over SAML metadata XML, and there's no way to standardize that away.
- **Multi-tenancy shape**: the real-world norm is one Okta org per customer. Don't build against Okta's own internal multi-tenancy tooling (Identity Engine, Org2Org) — that's for Okta managing its own orgs, not for how a third-party vendor federates with many separate customer orgs. Instead: store per-tenant IdP config (SAML cert/metadata, or OIDC issuer + client_id), resolve the tenant by email domain or subdomain, then validate the assertion/token against that tenant's stored config.
- **Provisioning**: SCIM 2.0 against ZenoSource's own `/Users` and `/Groups` endpoints — create, attribute updates, deactivate on offboarding, and Group Push for role/group sync. Each tenant's Okta connection gets its own SCIM bearer token, and that token *is* the tenant boundary: a bug that lets one tenant's SCIM token touch another tenant's users is a severe multi-tenancy breach, not just a permissions bug.
- **Internal vs. external users**: internal (buyer-org) users authenticate via the tenant's federated Okta (SSO). External (supplier) users have no Okta involvement at all — in v1 they act exclusively through scoped, no-login action-view links; persistent app-native supplier accounts are deferred (see [docs/todo.md#decided](todo.md#decided)). Both paths — SSO sessions and scoped action-view grants — land behind one session/authorization layer so the rest of the platform is agnostic to which path a user came in through.
- **Design for a second IdP now, not later**: keep SSO/SCIM logic behind a protocol-agnostic broker — per-tenant connection config, tenant resolved *before* assertion/token validation, protocol differences abstracted below the business logic. This is the pattern dedicated auth-broker products use (SAML Jackson/Ory Polis, WorkOS, Frontegg, Scalekit). Building it this way from the start makes Entra ID or Google Workspace a config addition later instead of a rewrite of the auth path.

### What Phase 3 built

- **One connection per tenant, carrying one protocol.** `IntegrationConnection` is unique on
  (tenant, integration), and a customer's own admin already chose OIDC or SAML when they created the
  application at their end — so it is a field on the connect form, not two integrations to pick
  between. Provisioning is protocol-independent, so splitting on protocol would have stranded Group
  Push on whichever half a customer did not choose.
- **Tenant resolution happens twice, and never from the credential.** Starting a sign-in resolves it
  from the *email domain* a person typed (`TenantDomain`, globally unique — two tenants claiming one
  domain is an account takeover, so a unique index makes it impossible rather than unlikely).
  Completing one resolves it from the *URL path segment* (`Tenant.slug`). Neither reads the
  assertion or the token, which is the security content of "resolve first, validate second": a
  document must never nominate the keys used to trust it.
- **A per-tenant service-provider identifier**, `{APP_BASE_URL}/sso/saml/{slug}`. This is what makes
  `Audience` a real multi-tenancy control rather than a formality: two customers federating from the
  same Okta org cannot replay each other's sign-ins. It costs one more tenant-specific string in
  onboarding, which is the right trade.
- **Identity-provider-initiated sign-in is refused.** A response must answer a request we made, and
  that request is a single-use row consumed by one atomic statement. Without it the only replay
  window would be the assertion's own validity period. An Okta app tile is configured as an
  SP-initiated launch into `/login/sso` instead.
- **SSO never replaces password sign-in.** There is no per-tenant "SSO required" switch — see
  [docs/todo.md](todo.md) for why, and what it would take.
- **Directory tokens are hashed, not sealed.** `secrets.ts` is reversible because an ERP credential
  must be replayed outbound; a token we only ever *verify* is looked up by the value somebody
  presents, which a fresh IV per value makes impossible. Several live tokens per connection, so a
  rotation can overlap instead of needing a window in which offboarding is broken.
- **The platform authenticates the directory caller and hands the connector a pre-scoped store.**
  No method on that port takes a tenant id, so there is no signature into which the wrong tenant can
  be passed. That is the boundary this document calls "a severe multi-tenancy breach" if it fails,
  and it is enforced by shape rather than by connector good behaviour.

### The honest half

- **Nothing here has met a real Okta org**, exactly as the Epicor connector has never met a Kinetic
  instance. The difference is worth stating plainly: a wrong entity-set name there shows an empty
  screen; a wrong assertion validation here shows the wrong person's purchase orders. What a first
  real org is expected to change — claim names, whether the response element is signed, the exact
  shape of an `active` patch, group payloads — is listed in
  [integrations/idp/okta/README.md](../integrations/idp/okta/README.md#adapting-to-a-real-okta-org),
  and every one of them is a candidate-list entry or a config field rather than a code change.
- **A claimed domain is only ever as good as the person who claimed it.** An owner adds a domain on
  the SSO settings page and it starts routing immediately. The global unique constraint is the real
  control — nobody else can claim it afterwards — but nothing proves the owner controls the domain
  they typed. That is honest while tenants exist only through `prisma/seed.ts`; it stops being
  enough the moment Phase 4 ships signup, and [docs/todo.md](todo.md) says so.
- **Encrypted assertions are refused by name.** If a customer's policy requires them, the message
  names the setting to turn off rather than reporting a signature failure. Supporting them means a
  decryption key to seal and rotate and a second class of parser vulnerability, for a property TLS
  to the callback already provides.
- **Nothing rate-limits the sign-in or directory endpoints.** They are the first unauthenticated,
  database-writing, XML-parsing surfaces in the product. There is no rate-limiting infrastructure in
  this codebase and inventing one for two routes is a hosting concern (Phase 6, at the edge);
  Phase 5's security review is where this gets a real answer rather than a rediscovery.
- **Single logout is not implemented.** What an admin actually asks for — "when I disable someone in
  Okta they lose access" — is delivered by SCIM deactivation plus a per-request status read in the
  DAL. Shipping something called SLO that did not honour an admin-terminated session would be worse
  than not shipping it.

## Adding a new integration

1. Register it: `id`, `type` (`erp` | `idp` | ...), declared `capabilities[]`.
2. Implement it as its own subproject under `integrations/<type>/<name>/`.
3. Map its native data/protocol to ZenoSource's canonical entities — don't leak vendor-specific shapes (Epicor's BO names, Okta's SCIM schema, etc.) into core platform code. This is no longer only a rule: `apps/platform/src/lib/integrations/vocabulary.test.ts` greps for both, and for assertion element names and token wire parameters, and fails the build. It is scoped to protocol *shapes* and never to vendor names — a customer connecting Okta should be told it is Okta.
4. Document, in this file, what capability it provides and what capability (if any) it hard-requires from elsewhere.
