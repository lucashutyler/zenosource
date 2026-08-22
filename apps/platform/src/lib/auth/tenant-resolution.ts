import "server-only";
import { db } from "@/lib/db";
import { domainOf, isPublicEmailDomain } from "./public-domains";

// Which organization an inbound sign-in belongs to.
//
// docs/integrations.md: "store per-tenant IdP config, resolve the tenant by
// email domain or subdomain, then validate the assertion/token against that
// tenant's stored config." The ordering is the point. Resolving a tenant from
// anything inside the credential — an assertion's Issuer, a token's `iss` —
// lets attacker-controlled input choose which certificate is used to trust it,
// which is circular and is the bug this ordering exists to prevent.
//
// So there are exactly two entry points, and neither takes a request body:
//
//   * by slug, from the URL path segment, when a credential is coming back;
//   * by email domain, from what a person typed, when a sign-in is starting.
//
// Two functions rather than one with a mode parameter, deliberately. The one
// place in the system whose whole job is to be unambiguous should not have an
// ambiguous signature.

export type ResolvedTenant = { id: string; name: string; slug: string };

const SELECT = { id: true, name: true, slug: true } as const;

export async function resolveTenantBySlug(slug: string): Promise<ResolvedTenant | null> {
  const trimmed = slug.trim().toLowerCase();
  if (!trimmed) return null;
  return db.tenant.findUnique({ where: { slug: trimmed }, select: SELECT });
}

/**
 * Only a *verified* domain routes anywhere. An unverified row is a claim an
 * owner has made and nothing more — see TenantDomain in the schema, and
 * docs/todo.md for exactly what "verified" is allowed to mean before there is
 * a signup flow to defend against.
 */
export async function resolveTenantByEmailDomain(email: string): Promise<ResolvedTenant | null> {
  const domain = domainOf(email);
  if (!domain) return null;
  // A consumer address identifies a person, never an organization. Refused
  // here as well as at claim time, so a row that predates the check cannot
  // route anything.
  if (isPublicEmailDomain(domain)) return null;

  const claim = await db.tenantDomain.findUnique({
    where: { domain },
    select: { verifiedAt: true, tenant: { select: SELECT } },
  });
  if (!claim?.verifiedAt) return null;
  return claim.tenant;
}
