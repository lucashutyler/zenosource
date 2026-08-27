import "server-only";

// Sealing for integration credentials.
//
// An IntegrationConnection holds what is usually an ERP *service account* —
// in Epicor's case an API key plus a Basic/OAuth2 identity that between them
// can read and write purchase orders across a buyer's whole company. In a
// shared multi-tenant database
// (docs/architecture.md#tenancy--users: one database, tenants isolated by
// tenant_id) that would be the single worst row in the schema to hold in
// plaintext, so it isn't held in plaintext.
//
// What this protects against: a leaked database dump, a backup on someone's
// laptop, a read-only SQL console, an errant `SELECT *` in a support session,
// and log lines that accidentally carry a row. That covers the realistic
// exposure for a product at this stage.
//
// What it does NOT protect against, stated plainly so nobody mistakes it for
// more than it is: the key sits in the application's own environment, so
// anything that can run code as the app can decrypt. Real separation needs a
// KMS holding the key and ideally per-tenant data keys, which is a hosting
// decision (Phase 6) reviewed in Phase 5's "security review of multi-tenant
// auth boundaries". The format is versioned precisely so that upgrade is a
// re-seal pass and not a schema change.
//
// A directory bearer token is hashed rather than sealed: it is looked *up* by
// the value presented, which a fresh IV makes impossible.

export {
  sealSecrets,
  openSecrets,
  sealingIsConfigured,
  hint,
} from "./secret-box";
