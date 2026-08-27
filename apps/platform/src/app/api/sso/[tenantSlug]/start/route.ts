import { NextResponse, type NextRequest } from "next/server";
import { beginSignIn, signInConnectionFor } from "@/lib/auth/broker";
import { resolveTenantBySlug } from "@/lib/auth/tenant-resolution";
import { SSO_COOKIE } from "@/lib/auth/sso-request";
import { safeReturnTo } from "@/lib/auth/return-to";

// The SAML path underneath reaches for the XML stack, which is CommonJS and is
// listed in next.config.ts's serverExternalPackages.
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string }> }
) {
  const { tenantSlug } = await params;
  const tenant = await resolveTenantBySlug(tenantSlug);
  if (!tenant) {
    return NextResponse.redirect(new URL("/login?sso=unknown", request.nextUrl));
  }

  const connection = await signInConnectionFor(tenant.id);
  if (!connection) {
    return NextResponse.redirect(new URL("/login?sso=unavailable", request.nextUrl));
  }

  // Nothing downstream trusts this: whoever comes back is whoever their
  // identity provider says came back.
  const hint = request.nextUrl.searchParams.get("hint");
  const started = await beginSignIn({
    tenant,
    connection,
    redirectTo: safeReturnTo(request.nextUrl.searchParams.get("returnTo")),
    loginHint: hint && hint.includes("@") ? hint.slice(0, 320) : null,
  });
  if (!started.ok) {
    return NextResponse.redirect(new URL("/login?sso=failed", request.nextUrl));
  }

  const response = NextResponse.redirect(started.url);
  response.cookies.set(SSO_COOKIE, started.cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Not `lax`: a SAML response arrives as a cross-site form POST, which a Lax
    // cookie is not sent on. `none` requires `secure`, so dev and E2E, which
    // serve plain HTTP, fall back to the server-side single-use row alone.
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/api/sso",
    maxAge: 600,
  });
  return response;
}
