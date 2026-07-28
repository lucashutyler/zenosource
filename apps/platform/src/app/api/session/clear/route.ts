import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/session";

// Route Handlers (unlike page renders) are allowed to mutate cookies —
// see src/lib/dal.ts for why this exists: a page render can detect a
// stale session (valid cookie, deleted user) but can't clear the cookie
// itself, so it redirects here instead of straight to /login.
export async function GET(request: Request) {
  await deleteSession();
  return NextResponse.redirect(new URL("/login", request.url));
}
