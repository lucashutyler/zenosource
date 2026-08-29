import "server-only";

const FALLBACK = "/dashboard";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return FALLBACK;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return FALLBACK;
  // `//evil.test` and `/\evil.test` are both protocol-relative in a browser.
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return FALLBACK;
  if (/^\/[^/]*:/.test(trimmed)) return FALLBACK;
  if (CONTROL_CHARACTERS.test(trimmed)) return FALLBACK;
  if (trimmed.startsWith("/login") || trimmed.startsWith("/api/")) return FALLBACK;
  return trimmed;
}
