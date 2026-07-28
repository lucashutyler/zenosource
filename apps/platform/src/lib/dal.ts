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
  return db.internalUser.findUnique({
    where: { id: session.internalUserId },
    select: { id: true, tenantId: true, name: true, email: true, role: true },
  });
});
