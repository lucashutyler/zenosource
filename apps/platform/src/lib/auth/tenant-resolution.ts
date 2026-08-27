import "server-only";
import { db } from "@/lib/db";
import { domainOf, isPublicEmailDomain } from "./public-domains";

// The tenant comes from the URL slug or from what a person typed, never from
// anything inside the credential: letting an assertion's issuer choose the
// certificate it is trusted against is circular.

export type ResolvedTenant = { id: string; name: string; slug: string };

const SELECT = { id: true, name: true, slug: true } as const;

export async function resolveTenantBySlug(slug: string): Promise<ResolvedTenant | null> {
  const trimmed = slug.trim().toLowerCase();
  if (!trimmed) return null;
  return db.tenant.findUnique({ where: { slug: trimmed }, select: SELECT });
}

/** Only a *verified* domain routes anywhere; an unverified row is an unproven claim. */
export async function resolveTenantByEmailDomain(email: string): Promise<ResolvedTenant | null> {
  const domain = domainOf(email);
  if (!domain) return null;
  // A consumer address identifies a person, never an organization. Refused
  // here as well as at claim time, so an older row cannot route anything.
  if (isPublicEmailDomain(domain)) return null;

  const claim = await db.tenantDomain.findUnique({
    where: { domain },
    select: { verifiedAt: true, tenant: { select: SELECT } },
  });
  if (!claim?.verifiedAt) return null;
  return claim.tenant;
}
