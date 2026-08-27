import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/session";

// Optimistic check only, with no database hit: the DAL's verifySession() is the
// real enforcement point.

// /a/[token] = external action-view links, no login.
// /api/sso/ = the federated sign-in legs, which run before there is a session.
const PUBLIC_PREFIXES = ["/login", "/a/", "/about", "/api/session/clear", "/api/sso/"];

// Not public — not cookie-authenticated, and answering with their own status
// codes: a directory's provisioning console reads a redirect to the HTML
// sign-in page as an opaque failure and disables provisioning at its end.
const SELF_AUTHENTICATING_PREFIXES = ["/api/scim/"];

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (SELF_AUTHENTICATING_PREFIXES.some((p) => path.startsWith(p))) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));

  const session = await readSession();

  if (!isPublic && !session) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  if (path === "/login" && session) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
