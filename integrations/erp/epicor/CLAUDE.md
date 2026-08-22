# integrations/erp/epicor

Epicor Kinetic connector. Read [README.md](README.md) first — it covers the shape, the two-credential model, and why suggestions are read-only. This file is the working rules.

## The one rule

**Nothing Epicor-shaped leaves this package.** No BO name, no OData fragment, no Kinetic status code appears in `apps/platform`. The boundary is `src/connector.ts`, and the platform imports `epicorConnector` and nothing else. If a change here requires a change in platform code that isn't a new field on a canonical record, the mapping is in the wrong place.

The inverse also holds: this package imports nothing from the platform. `src/types.ts` restates the canonical shapes structurally rather than importing them, which is what keeps the package free of Prisma and independently deployable. `apps/platform/src/lib/integrations/conformance.test.ts` is what catches drift between the two.

## Zero runtime dependencies

Keep it that way. Global `fetch`, `node:` builtins, nothing else. A dependency here ships into the platform's bundle and into whatever eventually runs this connector standalone.

## Tests never touch a network

Every spec runs against `src/testing/fake-kinetic.ts`. There is no Kinetic instance in CI and there won't be before a pilot customer, so a test that needs one is a test that will be skipped and then deleted. The transport is injected (`new EpicorConnector({ fetchImpl })`) precisely so this stays true.

## What to be careful about

- **Dates.** Never `new Date(epicorString)` then re-serialize. Take the date part textually with `dateOnly()`. The platform fixed "every user-entered date renders one day early" at thirteen call sites in Phase 1b; an ERP feed is a fourteenth way in, and `src/map/scalars.test.ts` pins it.
- **Decimals.** Cross the boundary as strings via `decimalString()`, never as numbers, and never with exponential notation. Out-of-range values return `undefined` so the record is skipped with a reason rather than silently rounded — the platform's columns are `Decimal(14,4)` and the seeded `$12 trillion` order is what happens when nothing bounds them.
- **Column names.** Add a candidate to `field(row, …)` rather than forking a mapper.
- **Status mapping.** `mapStatus` may return `null`, and that is the important case: it means "the ERP has nothing to say here, leave ZenoSource's own status alone." An approved open Epicor PO maps to `ISSUED` at most and never overwrites `ACKNOWLEDGED` — Epicor cannot see that a supplier answered through ZenoSource, and a nightly sync that erased an acknowledgment would re-chase a supplier who already replied.
- **Credentials.** They arrive already decrypted in `ConnectorSession` and must never be logged, echoed into an error message, or cached on the connector — `EpicorConnector` builds a fresh `EpicorClient` per call specifically so one tenant's OAuth2 bearer can't be picked up by another's request.
- **Query strings** are built by hand, not with `URLSearchParams` — it encodes a space as `+`, which some OData servers read literally and reject a `$filter` over.
