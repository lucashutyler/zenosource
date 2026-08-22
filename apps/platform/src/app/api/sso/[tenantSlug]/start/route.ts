import { NextResponse, type NextRequest } from "next/server";
import { beginSignIn, signInConnectionFor } from "@/lib/auth/broker";
import { resolveTenantBySlug } from "@/lib/auth/tenant-resolution";
import { SSO_COOKIE } from "@/lib/auth/sso-request";
import { safeReturnTo } from "@/lib/auth/return-to";

// Where a federated sign-in begins.
//
// The tenant comes from the path segment and nothing else, which is the
// ordering docs/integrations.md requires — resolve the tenant, *then* validate
// anything. At this end there is nothing to validate yet; the point is that by
// the time there is, the answer was already fixed by the URL a person visited.
//
// Node runtime: the SAML path underneath reaches for the XML stack, which is
// CommonJS and is listed in next.config.ts's serverExternalPackages.
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

  // `hint` is only ever the address somebody typed on the sign-in page, and it
  // is handed to the identity provider as a courtesy so they are not asked who
  // they are twice. Nothing downstream trusts it: whoever comes back is
  // whoever their identity provider says came back.
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
    // Not `lax`. A SAML response arrives as a cross-site form POST, and a Lax
    // cookie is not sent on one — so the binding this cookie exists to provide
    // would be missing on exactly the protocol that most needs it. `none`
    // requires `secure`, which is not available on the plain-HTTP dev and E2E
    // servers, so it is set only where it can be honoured. The server-side
    // single-use row is the guarantee either way; this is the second factor.
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    // Narrow enough that it is never sent to a page, only back to the callback.
    path: "/api/sso",
    maxAge: 600,
  });
  return response;
}
