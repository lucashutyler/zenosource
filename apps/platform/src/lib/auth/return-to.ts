import "server-only";

// Guards the path a user's own browser asked for before the round trip. An
// open redirect through a sign-in flow is a phishing primitive: a link that
// really does sign someone in, and then lands them somewhere else.

const FALLBACK = "/dashboard";

// The newline would otherwise splice this value into a Location header.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return FALLBACK;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return FALLBACK;
  // `//evil.test` and `/\evil.test` are both protocol-relative in a browser.
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return FALLBACK;
  // A scheme before the first path separator.
  if (/^\/[^/]*:/.test(trimmed)) return FALLBACK;
  if (CONTROL_CHARACTERS.test(trimmed)) return FALLBACK;
  // Never bounce back into the sign-in machinery: a loop ending at the login
  // page reads as "sign-in is broken" rather than "that link was odd".
  if (trimmed.startsWith("/login") || trimmed.startsWith("/api/")) return FALLBACK;
  return trimmed;
}
