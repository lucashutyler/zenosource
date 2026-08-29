# integrations/idp/okta

Okta identity-provider connector — sign-in over OIDC or SAML, and inbound SCIM 2.0 directory
provisioning. Read [README.md](README.md) first; it covers the shape, the two protocols, and why the
directory leg runs inwards. This file is the working rules.

## The one rule

**Nothing protocol-shaped leaves this package.** No SCIM schema URN, no SAML element name, no OIDC
wire parameter appears in `apps/platform`. The boundary is `src/connector.ts`, and the platform
imports `oktaConnector` and nothing else on the running path. If a change here requires a change in
platform code that isn't a new field on a canonical record, the mapping is in the wrong place.

The inverse also holds: this package imports nothing from the platform. `src/types.ts` restates the
canonical shapes structurally rather than importing them, which is what keeps the package free of
Prisma and independently deployable. `apps/platform/src/lib/integrations/conformance.test.ts` is what
catches drift between the two.

## Dependencies: the exception, and its argument

Epicor's rule is "zero runtime dependencies, keep it that way", with a stated reason — a dependency
there ships into the platform's bundle and into whatever eventually runs the connector standalone.
That is a per-package rule with a weight argument, and it does not reach this package's hard part.

This package has four runtime dependencies. Each one gets its argument written down, and a fifth
needs the same:

- **`@node-saml/node-saml`** (pinned exact). The alternative is not "verify with `node:crypto`" —
  Node ships RSA verification and no XML parser, so hand-rolling means writing exclusive
  canonicalisation, XML-DSig reference processing, and a parser to run them over. Three
  specifications with no partial credit, whose failure mode is a document that verifies when it
  should not, rather than a sign-in that visibly breaks. SAML libraries are demonstrably where the
  CVEs live, which is an argument for pinning and for `src/saml/guards.ts` — not an argument for
  writing a fifth implementation.
- **`jose`** (pinned exact). Already a dependency of `apps/platform` for session cookies. Signature
  verification and JWKS caching, both of which have the same "silent bypass" failure mode.
- **`@xmldom/xmldom`** (pinned exact). The guards need a real parser to walk a document; a regular
  expression over XML is how a certificate gets read out of the wrong element. Already in the tree
  underneath node-saml — declaring it directly is honesty about what we use, not new weight.
- **`xml-crypto`** (pinned exact). Only `src/testing/fake-okta.ts` uses it, to *sign* fixtures, so
  the specs verify real signatures over real canonicalisation instead of a mock returning `true`.
  It is a runtime dependency rather than a dev one because the fake is reachable through the
  `@zenosource/okta/testing` entry point, which the E2E runner and `npm run fake-idp` both import.

## Tests never touch a network, and never touch a real Okta org

Every spec runs against `src/testing/fake-okta.ts`, an injected transport in exactly the position
`integrations/erp/epicor/src/testing/fake-kinetic.ts` occupies. There is no Okta org in CI and there
won't be before a pilot customer, so a test that needs one is a test that will be skipped and then
deleted.

The fake is **not** a stub. It mints genuinely RS256-signed tokens and genuinely `xml-crypto`-signed
assertions against a self-signed certificate generated in memory at import (`src/testing/
certificate.ts` — about eighty lines of DER, so that a public MIT repository never carries a private
key and no test needs `openssl` on `PATH`). A signature-wrapping test is therefore a real signature
being wrapped.

`createFakeOkta` is exported from `@zenosource/okta/testing`, never from the package root. Reaching a
credential-minting fake requires importing a path whose name says what it is, and nothing under
`apps/platform/src` may import it.

## What to be careful about

- **The algorithm allowlist is ours, never the token's.** A verifier selected from a document's own
  `alg` header is how both `alg: none` and RS256/HS256 confusion work: the attacker picks the
  algorithm and therefore picks whether a key is needed at all. `src/oidc/verify.ts` passes an
  explicit list to `jwtVerify`; `src/saml/guards.ts` checks `SignatureMethod` against a set.
- **The embedded certificate selects, it never verifies.** A document that nominates the key used to
  trust it is not evidence of anything. `guards.ts` compares an embedded certificate against the
  tenant's stored list and refuses an unmatched one.
- **`guards.ts` runs before and after the library.** Signature wrapping does not forge a signature —
  it exploits the gap between what was verified and what gets read. Three separate mitigations, and
  `src/testing/xsw-variants.ts` × `src/saml/verify.test.ts` is the suite that keeps them honest. Any
  new option on the `SAML` constructor is a security property: pin it rather than inherit it.
- **Identity-provider-initiated sign-in is refused.** `InResponseTo` is required and must match the
  request the platform minted. Without a request of ours to answer, the only replay window is the
  assertion's own validity period. An Okta tile is configured as a launch into `/login/sso`.
- **The stable subject is never the email.** A directory can change someone's address; an account
  matched on a mutable value is an account somebody else can be handed.
- **A directory patch we cannot read is a 400, never a 200.** A 200 is recorded as success and stops
  the retry, so a deactivation we silently failed to parse leaves a departed employee with their
  access and the directory's own console showing green. `src/scim/patch.ts` fails loudly by design.
- **`handleDirectoryRequest` gets a store, not a tenant id.** No method on `DirectoryStore` takes
  one, so there is no signature into which the wrong tenant can be passed. That boundary is the
  platform's to build and this package's not to undermine — don't add a tenant parameter here.
- **Certificates are a list.** An identity provider publishes its next certificate beside its current
  one during a rollover; single-valued handling turns the most routine event in identity operations
  into an outage.
