"use server";

import { revalidatePath } from "next/cache";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { type FormState, fail, failWith } from "@/lib/form-state";
import { idpConnectionFor } from "@/lib/auth/broker";
import { issueDirectoryToken, revokeDirectoryToken } from "@/lib/auth/directory-tokens";
import { domainOf, isPublicEmailDomain } from "@/lib/auth/public-domains";
import { setGroupMapping } from "@/lib/directory/mapping";

// FormState plus the one thing this file returns that no other action does:
// a credential, shown once. It is not stored anywhere that could give it back,
// so if the page loses it the only option is issuing another — which is the
// honest position for a token we deliberately cannot recover.
export type DirectoryActionState =
  | (NonNullable<FormState> & { issuedToken?: string })
  | undefined;

// Everything here is OWNER-only, for the same reason connecting an integration
// is: a directory token can create and deactivate users across the whole
// organization, and a domain claim decides whose identity provider gets to
// authenticate an address. Both are strictly larger than anything a MEMBER can
// do.
async function requireOwner(formData: FormData) {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") {
    return { user: null, error: failWith(formData, "Only owners can manage single sign-on.") };
  }
  return { user, error: null };
}

function revalidate() {
  revalidatePath("/dashboard/integrations/sso");
  revalidatePath("/dashboard/integrations");
}

export async function issueToken(
  _state: DirectoryActionState,
  formData: FormData
): Promise<DirectoryActionState> {
  const { user, error } = await requireOwner(formData);
  if (!user) return error;

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return fail(formData, { name: "Give it a name, so you know which one to revoke." });

  const connection = await idpConnectionFor(user.tenantId);
  if (!connection) {
    return failWith(formData, "Connect your identity provider before issuing a token for it.");
  }

  const issued = await issueDirectoryToken({
    tenantId: user.tenantId,
    connectionId: connection.id,
    name,
    createdByUserId: user.id,
  });

  revalidate();
  // Returned once, and only once — it is not stored anywhere that could give
  // it back. Copying it now or issuing another are the only two options, which
  // is the honest position for a credential we deliberately cannot recover.
  return { ok: "Token created. Copy it now — it can't be shown again.", issuedToken: issued.plaintext };
}

export async function revokeToken(formData: FormData): Promise<void> {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") return;
  await revokeDirectoryToken(String(formData.get("tokenId") ?? ""), user.tenantId);
  revalidate();
}

export async function addDomain(
  _state: DirectoryActionState,
  formData: FormData
): Promise<DirectoryActionState> {
  const { user, error } = await requireOwner(formData);
  if (!user) return error;

  const raw = String(formData.get("domain") ?? "").trim().toLowerCase();
  const domain = raw.includes("@") ? domainOf(raw) : raw;
  if (!domain || !domain.includes(".") || /\s/.test(domain)) {
    return fail(formData, { domain: "That doesn't look like a domain." });
  }
  if (isPublicEmailDomain(domain)) {
    return fail(formData, {
      domain:
        "That's a personal email provider, so it can't identify an organization. Use a domain your company owns.",
    });
  }

  const existing = await db.tenantDomain.findUnique({
    where: { domain },
    select: { tenantId: true },
  });
  if (existing) {
    // The unique index is the real control; this is the sentence in front of
    // it. Deliberately the same message whether the claim is this tenant's or
    // somebody else's — "another organization has claimed acme.com" tells a
    // stranger that a competitor is a customer.
    return fail(
      formData,
      existing.tenantId === user.tenantId
        ? { domain: "You've already added that one." }
        : { domain: "That domain can't be added." }
    );
  }

  await db.tenantDomain.create({
    data: {
      tenantId: user.tenantId,
      domain,
      // Verified by the act of an owner adding it, which is exactly as much as
      // that proves. See TenantDomain in the schema and docs/todo.md for what
      // this does and does not mean, and what changes when signup ships.
      verifiedAt: new Date(),
    },
  });

  revalidate();
  return { ok: `Anyone with an @${domain} address can now sign in through your identity provider.` };
}

export async function removeDomain(formData: FormData): Promise<void> {
  const user = await getCurrentInternalUser();
  if (user.role !== "OWNER") return;
  await db.tenantDomain.deleteMany({
    where: { id: String(formData.get("domainId") ?? ""), tenantId: user.tenantId },
  });
  revalidate();
}

export async function saveGroupMapping(
  _state: DirectoryActionState,
  formData: FormData
): Promise<DirectoryActionState> {
  const { user, error } = await requireOwner(formData);
  if (!user) return error;

  const groupId = String(formData.get("groupId") ?? "");
  const roleRaw = String(formData.get("mappedRole") ?? "");
  const role = roleRaw === "MEMBER" ? "MEMBER" : null;
  const locationIds = formData.getAll("locationIds").map(String).filter(Boolean);

  const result = await setGroupMapping({
    tenantId: user.tenantId,
    groupId,
    role,
    locationIds,
  });
  if (!result.ok) return failWith(formData, result.refused);

  revalidate();
  revalidatePath("/dashboard");
  return {
    ok: role
      ? "Saved. Everyone in that group has been updated."
      : "Saved. That group no longer grants anything.",
  };
}
