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
  // Ejecting a DEACTIVATED user here is the whole session-revocation mechanism:
  // a session is a stateless signed cookie that nothing else expires early.
  if (!user || user.status === "DEACTIVATED") {
    // Next allows mutating cookies only from a Server Action or Route Handler,
    // never a render path, and /login would loop while the cookie is still
    // there — so the clearing happens in a route handler.
    redirect("/api/session/clear");
  }
  return user;
});
