import "server-only";

// Where to land after signing in.
//
// An open redirect through a sign-in flow is the classic phishing primitive: a
// link that genuinely goes to the real product, genuinely signs someone in,
// and then puts them somewhere that isn't. The main defence is structural
// rather than a filter — the value an identity provider echoes back carries an
// opaque handle and nothing else, so no code path interprets an identity
// provider's string as a URL at all. This function guards the other end: the
// path a user's own browser asked for before the round trip started.
//
// Applied twice, at store time and again at redirect time. Once would do
// today; twice survives someone later writing to the column directly.

const FALLBACK = "/dashboard";

// Control characters, including the newline that would otherwise let this
// value be spliced into a Location header.
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
