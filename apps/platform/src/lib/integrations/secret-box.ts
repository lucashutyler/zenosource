// No `server-only` marker: prisma/seed.ts seals credentials under tsx, where
// importing it throws. secrets.ts carries the marker and is the module every
// application path imports.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard; 96-bit nonce
const KEY_ENV = "INTEGRATION_SECRET_KEY";

/**
 * Resolved per call: a module-level constant is captured at import time, so a
 * build-time value can outlive a key rotation.
 */
function key(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(
      `${KEY_ENV} is not set. Integration credentials cannot be stored without it — ` +
        `generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  // Hashed to exactly 32 bytes, never truncated or padded: a short key padded
  // out is a 256-bit cipher with 40 bits of entropy.
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
 * Seals into `v1.<iv>.<tag>.<ciphertext>`, all base64url — the version prefix
 * lets a future scheme land as a re-seal pass rather than a migration.
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

/** Throws on tampering: a modified ciphertext fails the auth tag rather than decrypting to garbage. */
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

export function sealingIsConfigured(): boolean {
  return Boolean(process.env[KEY_ENV]);
}

/** `••••••1a2b` — enough to confirm which secret is stored without reproducing it. */
export function hint(secret: string): string {
  const tail = secret.slice(-4);
  return `${"•".repeat(6)}${tail}`;
}
