import "server-only";

// Addresses that cannot identify an organization.
//
// A tenant claiming `gmail.com` would route every consumer address in the
// world at their identity provider, and the global unique constraint on
// TenantDomain means the first tenant to claim one would hold it permanently.
// So it is refused at the point of claiming rather than untangled later.
//
// Deliberately short. This is not an attempt at a complete list of free email
// providers — that list is unmaintainable, and its long tail is people running
// real companies on small providers. It is the handful common enough that an
// admin might type one by accident.

const PUBLIC_DOMAINS = new Set([
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.co.uk",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mac.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.co.uk",
  "yahoo.com",
  "ymail.com",
]);

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_DOMAINS.has(domain.trim().toLowerCase());
}

/** The domain part, lowercased. `null` when the input isn't one address. */
export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain.includes(".") || /\s/.test(domain)) return null;
  return domain;
}
