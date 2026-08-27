import "server-only";

// A tenant claiming `gmail.com` would route every consumer address in the world
// at their identity provider, and TenantDomain's global unique constraint means
// the first claimant would hold it permanently. Only the handful an admin might
// type by accident — a complete list of free providers is unmaintainable.

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
