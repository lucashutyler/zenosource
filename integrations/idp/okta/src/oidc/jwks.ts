import { createRemoteJWKSet, customFetch } from "jose";
import type { FetchLike } from "../types";

// The identity provider's public signing keys.
//
// `createRemoteJWKSet` is given the injected transport through jose's own
// `customFetch` symbol, so this stays inside the rule every outbound edge in
// this package follows and CI never touches a network. Two of its options are
// load-bearing and worth naming:
//
//   cacheMaxAge   — how long a fetched key set is reused. Ten minutes: long
//                   enough that a burst of sign-ins is one fetch, short enough
//                   that a rotation is picked up without anyone intervening.
//   cooldownDuration — the floor between refetches triggered by an unknown
//                   `kid`. Without it, an unauthenticated callback carrying a
//                   random `kid` is an outbound-request amplifier aimed at the
//                   customer's identity provider: one forged request in, one
//                   key fetch out, repeat. Thirty seconds turns that into
//                   nothing while still picking up a genuine rotation quickly.
//
// Caching a *public* key set keyed by its URL does not breach the rule that a
// connector holds no per-tenant state between calls — that rule is about
// credentials, and there is no secret here. Two tenants federating with the
// same identity provider legitimately share the entry.

type KeySet = ReturnType<typeof createRemoteJWKSet>;

const CACHE_MAX_AGE_MS = 600_000;
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

/** Tests reach for this so one spec's cached key set can't answer another's. */
export function resetJwksCache(): void {
  keySets.clear();
}
