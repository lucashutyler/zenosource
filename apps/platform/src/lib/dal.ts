import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { db } from "@/lib/db";

export const verifySession = cache(async () => {
  const session = await readSession();
  if (!session?.internalUserId) {
    redirect("/login");
  }
  return session;
});

export const getCurrentInternalUser = cache(async () => {
  const session = await verifySession();
  const user = await db.internalUser.findUnique({
    where: { id: session.internalUserId },
    select: { id: true, tenantId: true, name: true, email: true, role: true, status: true },
  });
  // A deactivated user takes the same branch as a deleted one, deliberately.
  // This is the whole session-revocation mechanism: sessions are stateless
  // signed cookies with a seven-day life, so nothing expires them early — but
  // this function is called by every page, action and route handler that
  // touches data, and it is cache()d per request rather than across requests.
  // So "the directory disabled Casey" takes effect on Casey's very next
  // request, which is what an admin means when they ask for it.
  if (!user || user.status === "DEACTIVATED") {
    // The session cookie is cryptographically valid but points at a user
    // that no longer exists (deleted account, or — in dev — a re-seed that
    // wiped and recreated everyone with fresh IDs). Treat that exactly
    // like no session at all instead of silently rendering broken/empty
    // UI. Can't clear the cookie here — Next.js only allows mutating
    // cookies from a Server Action or Route Handler, not a render path —
    // and redirecting straight to /login would loop forever, since proxy.ts
    // sees the (still-present) valid-looking cookie and bounces /login
    // back to /dashboard. Redirect through a route handler that actually
    // clears the cookie first instead.
    redirect("/api/session/clear");
  }
  return user;
});
