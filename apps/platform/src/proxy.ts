import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/session";

// Optimistic check only (cookie/JWT verification, no DB hit) — the DAL's
// verifySession() is the real enforcement point. See
// node_modules/next/dist/docs/01-app/02-guides/authentication.md
// #optimistic-checks-with-proxy-optional (this file replaces middleware.ts
// in this Next.js version).

const PUBLIC_PREFIXES = ["/login", "/a/"]; // /a/[token] = external action-view links, no login

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
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
