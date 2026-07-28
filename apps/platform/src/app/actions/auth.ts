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

  // Placeholder internal auth (docs/todo.md Phase 1) — email is unique per
  // tenant, not globally, so this picks the first match. Fine for a single
  // seeded dev tenant; revisit once there's more than one.
  const user = await db.internalUser.findFirst({ where: { email } });
  if (!user) {
    return { error: "Invalid email or password." };
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    return { error: "Invalid email or password." };
  }

  await createSession({ internalUserId: user.id, tenantId: user.tenantId });
  redirect("/dashboard");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
