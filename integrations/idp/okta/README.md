# integrations/idp/okta

The Okta identity-provider connector. Signs a buyer's team in over **OIDC or SAML**, and serves
**SCIM 2.0** so their directory can create, update and deactivate ZenoSource users.

Product context: [docs/integrations.md](../../../docs/integrations.md#okta-idp). Capability model:
[docs/architecture.md](../../../docs/architecture.md#extensibility--capability-model).

## Status

**Not yet validated against a real Okta org.** Everything here is written against the published
OpenID Connect, SAML 2.0 and SCIM 2.0 specifications and is covered by tests, but those tests run
against a scripted identity provider — there is no Okta in CI and won't be until a pilot customer
exists ([docs/todo.md](../../../docs/todo.md) Phase 5). Read
[Adapting to a real Okta org](#adapting-to-a-real-okta-org) before a first install.

The difference from the Epicor connector's equivalent warning is worth stating plainly: a wrong
entity-set name there shows an empty screen. A wrong assertion validation here shows the wrong
person's purchase orders.

## Stack

TypeScript, four pinned runtime dependencies, injected transport. No Prisma, no Next.js. See
[CLAUDE.md](CLAUDE.md) for why the dependency rule bends here and what the argument for each one is.

```bash
npm install
npm test        # no network, no database, no Okta
npm run typecheck
```

## Shape

| File | What it does |
|---|---|
| `src/connector.ts` | The `IdpConnector` the platform consumes. Everything else is private to this package. |
| `src/config.ts` | Connect-form parsing; splits non-secret config from sealed secrets. |
| `src/metadata.ts` | Reads a customer's identity-provider metadata into an entity id, a sign-in URL and a certificate list. |
| `src/oidc/discovery.ts` | Discovery, with the issuer checked byte-for-byte against what an admin typed. |
| `src/oidc/jwks.ts` | The identity provider's public signing keys, cached and cooldown-limited. |
| `src/oidc/verify.ts` | PKCE, the back-channel exchange, and every ID-token check. |
| `src/saml/request.ts` | The sign-in request. Unsigned, by decision. |
| `src/saml/verify.ts` | The only file importing the SAML library. |
| `src/saml/guards.ts` | What a signature verifier cannot know: shape, bindings, and trust. |
| `src/scim/` | The directory protocol, translated to the platform's `DirectoryStore` port. |
| `src/health.ts` | Connection health *and* capability probing, in one pass. |
| `src/sp-metadata.ts` | The document a customer's admin imports at their end. |
| `src/testing/fake-okta.ts` | The scripted identity provider every test runs against. |

## Two protocols, one connection

A customer's own admin picks OIDC or SAML once, when they create the application at their end
([docs/integrations.md](../../../docs/integrations.md#okta-idp)) — so it is a field on one connection
here, not two integrations to choose between. `IntegrationConnection` is unique on
(tenant, integration) because a second connection would mean two sources of truth, and directory
provisioning is protocol-independent: splitting on protocol would strand a customer's group push on
whichever half they did not pick.

## Everything a sign-in is checked against

Both protocols, in one list, because the point is that neither is trusted more than the other:

- The tenant is resolved from the **URL path**, before anything untrusted is parsed. An assertion
  never nominates which tenant — or therefore which certificate — validates it.
- The **audience** is the tenant's own service-provider identifier. Two customers inside one Okta org
  cannot replay each other's sign-ins.
- The response must **answer a request we made**, and that request is consumed exactly once by the
  platform. Identity-provider-initiated sign-in is refused.
- Signatures are checked against the **stored** certificates or key set, never against material the
  document supplies.
- The **algorithm allowlist is ours**: RS256 and SHA-256 family only.
- Document shape is checked separately from signature: exactly one assertion, unique identifiers,
  each reference covering its own parent, an exact two-transform list, and no comments inside the
  assertion.

## The directory runs inwards

Every other integration in this repo calls out to somebody else's system. This one is *called*: a
customer's directory pushes users and groups to us. Two consequences worth holding onto:

- **There is nothing outbound to probe**, so `checkHealth` grants `scim_provisioning` on any
  otherwise-healthy connection rather than pretending to verify it.
- **The bearer token is the tenant boundary**, and it is authenticated by the platform, not here.
  This package is handed a `DirectoryStore` already bound to one tenant, and no method on it takes a
  tenant id — so there is no signature into which the wrong one can be passed.

## Adapting to a real Okta org

The protocols are specifications, so the surprises will not be endpoint names the way Epicor's were.
Expect these instead, and prefer widening a candidate list or a config field over editing logic:

- **Claim and attribute names.** `src/oidc/verify.ts` and `src/saml/verify.ts` read through short
  candidate lists (`email`, the WS-Federation URI, `nameID`; `displayName`, `name`). A customer whose
  application maps things differently is one entry, not a fork.
- **Whether the response element is signed.** Okta signs the assertion by default and the response
  only when asked. `config.responseSigned` follows the customer's setting; requiring a signature that
  was never configured rejects every valid sign-in.
- **The `active` attribute's shape on a patch.** Four spellings are already handled
  (`src/scim/patch.ts`); a fifth is one branch, and anything unrecognised is a 400 rather than a
  silent success.
- **Group payloads.** Group Push sends membership as `add`/`remove` operations and occasionally as a
  wholesale replace. All three are handled; a fourth shape fails loudly.
- **Encrypted assertions are refused by name.** If a customer's policy requires them, the message
  says which setting to turn off rather than reporting a signature failure. Supporting them means a
  decryption key to seal and rotate and a second CVE surface, for a property TLS to the callback
  already provides.
