import { createRemoteJWKSet, customFetch } from "jose";
import type { FetchLike } from "../types";

type KeySet = ReturnType<typeof createRemoteJWKSet>;

const CACHE_MAX_AGE_MS = 600_000;
// The cooldown floors refetches triggered by an unknown `kid`. Without it an
// unauthenticated callback carrying a random `kid` amplifies one forged request
// into one key fetch at the customer's identity provider.
const COOLDOWN_MS = 30_000;

const keySets = new Map<string, KeySet>();

export function jwksFor(fetchImpl: FetchLike, jwksUri: string): KeySet {
  const existing = keySets.get(jwksUri);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(jwksUri), {
    cacheMaxAge: CACHE_MAX_AGE_MS,
    cooldownDuration: COOLDOWN_MS,
    [customFetch]: fetchImpl as unknown as typeof fetch,
  });
  keySets.set(jwksUri, created);
  return created;
}

export function resetJwksCache(): void {
  keySets.clear();
}
