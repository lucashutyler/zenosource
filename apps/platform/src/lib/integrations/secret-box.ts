// The sealing primitives, with no server-only marker.
//
// Split out of secrets.ts for one reason: prisma/seed.ts needs to seal a
// connection's credentials, and it runs under tsx rather than inside Next's
// bundler — where importing `server-only` throws by design. The guard still
// stands where it can actually be violated: secrets.ts is the module every
// application path imports, it carries the marker, and a Client Component
// reaching for it still fails the build.
//
// Everything below is pure node:crypto. The rationale for the scheme, and an
// honest account of what it does and does not protect against, is in
// secrets.ts and has not moved.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

// Sealing for integration credentials.
//
// An IntegrationConnection holds what is usually an ERP *service account* —
// in Epicor's case an API key plus a Basic/OAuth2 identity that between them
// can read and write purchase orders across a buyer's whole company. In a
// shared multi-tenant database (docs/architecture.md#tenancy--users: one
// database, tenants isolated by tenant_id) that would be the single worst row
// in the schema to hold in plaintext, so it isn't held in plaintext.
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
// auth boundaries". The format below is versioned precisely so that upgrade
// is a re-seal pass and not a schema change.

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard; 96-bit nonce
const KEY_ENV = "INTEGRATION_SECRET_KEY";

/**
 * Resolved per call rather than at module load. A module-level constant would
 * be captured at import time, which in Next.js means a build-time value can
 * outlive a key rotation, and makes the missing-key error surface as a blank
 * page during a build instead of at the point of use.
 */
function key(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(
      `${KEY_ENV} is not set. Integration credentials cannot be stored without it — ` +
        `generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  // Accept base64 (the documented form) but tolerate any sufficiently long
  // string by hashing to exactly 32 bytes. Silently truncating or zero-padding
  // a short key is how a 256-bit cipher ends up with 40 bits of entropy.
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  if (raw.length < 32) {
    throw new Error(
      `${KEY_ENV} is too short — it must be 32 bytes of base64, or at least 32 characters.`
    );
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

/**
 * Seal a secrets bag into one opaque string: `v1.<iv>.<tag>.<ciphertext>`,
 * all base64url. One column, one round trip, and the version prefix means a
 * future scheme can be introduced without a migration or a flag day.
 */
export function sealSecrets(secrets: Record<string, string>): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const plaintext = Buffer.from(JSON.stringify(secrets), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Throws on tampering — GCM's auth tag is checked, so a modified ciphertext
 * fails loudly rather than decrypting to garbage that then gets sent to a
 * customer's ERP as credentials.
 */
export function openSecrets(sealed: string): Record<string, string> {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(`Unrecognized sealed-secret format (expected ${VERSION}.iv.tag.ciphertext).`);
  }
  const [, ivPart, tagPart, ctPart] = parts;
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctPart, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, string>;
}

/** Whether a key is configured at all — the connect form refuses to render without one. */
export function sealingIsConfigured(): boolean {
  return Boolean(process.env[KEY_ENV]);
}

/**
 * `••••••1a2b` — enough to confirm which key is stored without reproducing
 * it. The integrations page has to show *something*, and showing the value
 * (even masked in the DOM) puts a live ERP credential in a page a support
 * screenshot can capture.
 */
export function hint(secret: string): string {
  const tail = secret.slice(-4);
  return `${"•".repeat(6)}${tail}`;
}
