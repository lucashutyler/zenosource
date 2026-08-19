# integrations/erp/epicor

The Epicor Kinetic connector. Mirrors purchase orders, suppliers and vendor pricing into ZenoSource, surfaces the PO suggestions Kinetic's MRP run produces, and writes acknowledgments and decisions back.

Product context: [docs/integrations.md](../../../docs/integrations.md#epicor-erp). Capability model: [docs/architecture.md](../../../docs/architecture.md#extensibility--capability-model).

## Status

**Not yet validated against a live Kinetic instance.** Everything here is written against Epicor's documented REST v2 surface and is fully covered by tests, but those tests run against a scripted transport — there is no Kinetic in CI and won't be until a pilot customer exists ([docs/todo.md](../../../docs/todo.md) Phase 5). Read the [Adapting to a real instance](#adapting-to-a-real-instance) section before a first install; it is written on the assumption that some names will be wrong.

## Stack

TypeScript, zero runtime dependencies, global `fetch`. No Prisma, no Next.js, no framework.

That is deliberate and worth keeping. The connector is imported by `apps/platform` as a `file:` dependency and could equally sit behind an HTTP call once the Phase 6 hosting decision is made — neither is possible if it drags a database client along. Its own types (`src/types.ts`) are a structural restatement of the platform's connector contract rather than an import of it, so the dependency arrow points one way only.

```bash
npm install
npm test        # 59 specs, no network, no database
npm run typecheck
```

## Shape

| File | What it does |
|---|---|
| `src/connector.ts` | The `ErpConnector` the platform consumes. Everything else is private to this package. |
| `src/client.ts` | Kinetic REST transport: dual-credential headers, OAuth2 token caching, OData paging. |
| `src/errors.ts` | Failure classification — the API-key/identity distinction lives here. |
| `src/health.ts` | Connection health *and* capability probing, in one pass. |
| `src/config.ts` | Connect-form parsing; splits non-secret config from sealed secrets. |
| `src/bo/endpoints.ts` | Every version-sensitive service and entity-set name, overridable per connection. |
| `src/bo/pull.ts` | Reads: BO pages in, canonical batches out. |
| `src/baq.ts` | Writes, through Updatable BAQs. |
| `src/map/*` | Epicor rows → canonical records. Pure functions, no I/O. |
| `src/testing/fake-kinetic.ts` | The scripted transport every test runs against. |

## Two credentials, two failure modes

Every Kinetic call carries an API key *and* an identity (Basic, or an OAuth2 bearer). They are checked at different layers — the gateway validates the key before authentication runs — and they are fixed by different people in different screens. Reporting one generic "auth failed" sends a buyer's IT admin to the wrong screen roughly half the time, and each wrong guess is a support cycle during onboarding.

So `checkHealth` never guesses. It classifies from the response when Epicor's own message identifies the layer, and when the response is a bare unmarked 401 it re-sends the request with the identity header deliberately removed:

- same rejection → the request never reached authentication, so it is the key. `API_KEY`.
- a different, authentication-shaped rejection → the key got through. `IDENTITY`.

One extra request, and a coin-flip becomes an answer.

## Partial Access Scopes are normal

An Epicor API key is tied to an Access Scope granting specific services, so a key that can read `VendorSvc` and `POSvc` but not `POSuggSvc` is an ordinary customer configuration, not a broken one. The health check probes each capability separately and reports only what answered; the platform grants exactly those. Treating it as all-or-nothing either blocks a working connection or unlocks a PO Suggestions screen that is empty forever.

## Suggestions are read-only, permanently

Epicor's pipeline is demand → MRP → `POReqSvc` requisition → `POSuggSvc` suggestion → firm PO. Suggestions **cannot be created or updated over REST** — write attempts fail outright. A buyer accepting one here raises a *requisition*, which still has to clear approval inside Epicor before it becomes an order, and the connector says so in the result rather than reporting a bare success. This is a property of Epicor's data model, not a gap in this package.

## Write-back goes through Updatable BAQs

Not raw BO calls. A raw `POSvc.Update` needs the full dataset round-trip with row-state flags set correctly, runs every business-logic directive attached to the BO including ones the customer wrote, and needs BO-level security on an account that then holds far more authority than it should. An Updatable BAQ is a named, versioned contract the customer's own Epicor admin can inspect and grant narrowly — which matters at a buyer whose IT department will ask.

The cost, stated plainly: **these BAQs do not exist until someone deploys them.** `ZS-PO-Ack` and `ZS-PO-Sugg-Decision` are ours to ship and the customer's to import. A missing one surfaces as a specific message naming the BAQ, not a bare 404, and the ids are overridable per connection for customers with a naming standard.

## Adapting to a real instance

The service names (`Erp.BO.VendorSvc`, `Erp.BO.POSvc`, `Erp.BO.POSuggSvc`, `Erp.BO.VendPartSvc`) are stable and documented. The entity-set names beneath them, and the exact column spellings, vary by Kinetic version and by whether a site has customized its BOs. Two things make that survivable without a code change:

- **Endpoints** are all in `src/bo/endpoints.ts` and overridable per connection via `config.endpoints`.
- **Columns** are read through `field(row, "UnitCost", "DocUnitCost", …)` — a candidate list, so a version difference is one array entry rather than a forked mapper.

When a first real instance disagrees, prefer widening the candidate list or setting an override over editing a mapper's logic.
