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

  // Email is unique per tenant, not globally: the first match may be the
  // wrong organization.
  const candidates = await db.internalUser.findMany({
    where: { email },
    orderBy: { createdAt: "asc" },
  });

  let user: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    // Skipped, not compared: bcrypt.compare against null throws.
    if (!candidate.passwordHash) continue;
    if (await bcrypt.compare(password, candidate.passwordHash)) {
      user = candidate;
      break;
    }
  }

  // One message for every failure: anything more specific tells a stranger
  // which addresses exist here.
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
