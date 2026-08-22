"use server";

import * as z from "zod";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, deleteSession } from "@/lib/session";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1),
});

export type LoginState = { error?: string } | undefined;

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Enter an email and password." };
  }

  const { email, password } = parsed.data;

  // Email is unique per tenant, not globally (`@@unique([tenantId, email])`),
  // so the same address can legitimately exist in two organizations. Phase 1
  // took the first match and said so in a comment; Phase 3 adds a second door
  // and a second tenant to the seed, so "first match" would start signing
  // people into the wrong organization. Every candidate is tried, oldest
  // first, and whichever password verifies is the account.
  const candidates = await db.internalUser.findMany({
    where: { email },
    orderBy: { createdAt: "asc" },
  });

  let user: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    // A federated or directory-provisioned account has no password hash.
    // Skipped, not compared: bcrypt.compare against null throws, and treating
    // a null hash as a match would make every SSO user passwordless in the
    // literal sense.
    if (!candidate.passwordHash) continue;
    if (await bcrypt.compare(password, candidate.passwordHash)) {
      user = candidate;
      break;
    }
  }

  // One message for every failure — no password, wrong password, deactivated,
  // no such address. Anything more specific is an oracle telling a stranger
  // which addresses exist here and which organizations use single sign-on.
  if (!user || user.status === "DEACTIVATED") {
    return { error: "Invalid email or password." };
  }

  await createSession({ internalUserId: user.id, tenantId: user.tenantId });
  redirect("/dashboard");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
