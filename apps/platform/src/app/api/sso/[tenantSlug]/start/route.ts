import { NextResponse, type NextRequest } from "next/server";
import { beginSignIn, signInConnectionFor } from "@/lib/auth/broker";
import { resolveTenantBySlug } from "@/lib/auth/tenant-resolution";
import { SSO_COOKIE } from "@/lib/auth/sso-request";
import { safeReturnTo } from "@/lib/auth/return-to";

// The XML stack the SAML path reaches for is CommonJS: see serverExternalPackages.
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
    // A Lax cookie is not sent on the cross-site POST a SAML response arrives as.
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/api/sso",
    maxAge: 600,
  });
  return response;
}
