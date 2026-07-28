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
    select: { id: true, tenantId: true, name: true, email: true, role: true },
  });
  if (!user) {
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
