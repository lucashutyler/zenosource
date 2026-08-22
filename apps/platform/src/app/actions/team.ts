"use server";

import * as z from "zod";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { deactivateInternalUser } from "@/lib/offboarding";
import { getCurrentInternalUser } from "@/lib/dal";
import { type FormState, fail, failWith } from "@/lib/form-state";

export type FormActionState = FormState;

// Team management, which did not exist.
//
// A buyer organization could not onboard its second procurement person: no
// invite, no create, no role change, no deactivate, no password reset. The
// seeded users were the only users the tenant would ever have, and a
// forgotten password was permanent lockout with no recovery path in the
// product at all.
//
// This is the credentials-only placeholder from Phase 1 (docs/todo.md), not
// what Okta federation looks like in Phase 3 — but the tenant still has to be
// able to run itself in the meantime.

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") fieldErrors[field] ??= issue.message;
  }
  return fieldErrors;
}

const MIN_PASSWORD = 12;

const CreateUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(["OWNER", "MEMBER"]),
  password: z
    .string()
    .min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`),
});

export async function createTeamMember(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") {
    return failWith(formData, "Only owners can add people to the team.");
  }

  const parsed = CreateUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  if (!parsed.success) return fail(formData, zodFieldErrors(parsed.error));

  const existing = await db.internalUser.findFirst({
    where: { tenantId: user.tenantId, email: parsed.data.email },
  });
  if (existing) {
    return fail(formData, { email: `${parsed.data.email} is already on your team.` });
  }

  await db.internalUser.create({
    data: {
      tenantId: user.tenantId,
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      passwordHash: await bcrypt.hash(parsed.data.password, 10),
    },
  });

  revalidatePath("/dashboard/team");
  return { ok: `${parsed.data.name} added.` };
}

export async function setTeamMemberRole(internalUserId: string, role: "OWNER" | "MEMBER") {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") return;

  const target = await db.internalUser.findFirst({
    where: { id: internalUserId, tenantId: user.tenantId },
  });
  if (!target) return;

  // A tenant with no OWNER can't create locations, manage the team, or grant
  // itself back out of that state — and `pickInternalOwner` falls back to the
  // OWNER when a supplier rejects a PO, so losing the last one would strand
  // every future rejection with no internal owner at all.
  if (target.role === "OWNER" && role === "MEMBER") {
    const owners = await db.internalUser.count({
      where: { tenantId: user.tenantId, role: "OWNER", status: "ACTIVE" },
    });
    if (owners <= 1) return;
  }

  await db.internalUser.update({ where: { id: internalUserId }, data: { role } });
  revalidatePath("/dashboard/team");
}

const PasswordSchema = z.object({
  password: z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`),
});

/** An owner setting someone else's password — the lockout escape hatch. */
export async function resetTeamMemberPassword(
  internalUserId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") {
    return failWith(formData, "Only owners can reset passwords.");
  }

  const target = await db.internalUser.findFirst({
    where: { id: internalUserId, tenantId: user.tenantId, status: "ACTIVE" },
  });
  if (!target) return failWith(formData, "That person is no longer on your team.");

  const parsed = PasswordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) return fail(formData, zodFieldErrors(parsed.error));

  await db.internalUser.update({
    where: { id: internalUserId },
    data: { passwordHash: await bcrypt.hash(parsed.data.password, 10) },
  });

  revalidatePath("/dashboard/team");
  return { ok: `Password reset for ${target.name}.` };
}

const ChangeOwnPasswordSchema = z.object({
  current: z.string().min(1, "Enter your current password."),
  password: z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`),
});

export async function changeOwnPassword(
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();

  const parsed = ChangeOwnPasswordSchema.safeParse({
    current: formData.get("current"),
    password: formData.get("password"),
  });
  if (!parsed.success) return fail(formData, zodFieldErrors(parsed.error));

  const record = await db.internalUser.findUnique({ where: { id: user.id } });
  if (!record) return failWith(formData, "Not signed in.");

  if (!record.passwordHash) {
    // Signed in through the organization's identity provider, so there is no
    // password here to change — and setting one from this form would quietly
    // create a second way into an account the directory is meant to control.
    return failWith(
      formData,
      "You sign in through your organization's identity provider, so there's no password here to change."
    );
  }

  if (!(await bcrypt.compare(parsed.data.current, record.passwordHash))) {
    return fail(formData, { current: "That isn't your current password." });
  }

  await db.internalUser.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.password, 10) },
  });

  return { ok: "Password changed." };
}

/**
 * Reassign someone's open work, then step them out of the team.
 *
 * "Nothing survives the second person" was a named hole in the plan: an item
 * owned by someone who left looks fine to everyone else on the board, because
 * every count is scoped to its owner. Handing the work over is the point of
 * this action — removing the person is the easy half.
 */
export async function handOverAndDeactivate(
  internalUserId: string,
  _state: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") {
    return failWith(formData, "Only owners can remove people from the team.");
  }
  if (internalUserId === user.id) {
    return failWith(formData, "You can't hand over your own board to yourself.");
  }

  const target = await db.internalUser.findFirst({
    where: { id: internalUserId, tenantId: user.tenantId, status: "ACTIVE" },
  });
  if (!target) return failWith(formData, "That person is no longer on your team.");

  const successorId = String(formData.get("successorId") ?? "").trim();
  const successor =
    successorId === internalUserId
      ? null
      : await db.internalUser.findFirst({
          where: { id: successorId, tenantId: user.tenantId, status: "ACTIVE" },
        });
  if (!successor) {
    return fail(formData, { successorId: "Choose who picks up their open items." });
  }

  // The mechanics — the last-owner guard, the handover, the location
  // assignments moving with the work — live in src/lib/offboarding.ts, because
  // a directory deactivation has to do exactly the same thing at 3am with
  // nobody to ask. Two implementations of "somebody left" is two chances for
  // one of them to forget the handover.
  //
  // What changed in Phase 3, and why the previous comment here is gone: this
  // used to rotate the password hash to something unguessable and note that no
  // status column was needed, since the session layer treats a session
  // pointing at a missing user as unauthenticated. That held while a password
  // was the only door. It stopped holding the moment a federated user — who
  // has no password at all — could sign in, because rotating a null hash locks
  // out nobody and dal.ts finds the row and lets them straight in. Hence a
  // real status, read on every request.
  const result = await deactivateInternalUser({
    userId: internalUserId,
    successorId: successor.id,
    source: "TEAM_PAGE",
    moveLocations: true,
  });
  if (!result.ok) return failWith(formData, result.refused);

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard");
  return {
    ok: `${target.name} stepped down. ${result.moved} open item${result.moved === 1 ? "" : "s"} moved to ${successor.name}.`,
  };
}
