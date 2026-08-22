import "server-only";
import { db } from "@/lib/db";
import { recordDirectoryEvent } from "@/lib/directory/audit";
import type { FederatedIdentity } from "@/lib/integrations/idp-contract";

// A verified identity, turned into somebody on the team.
//
// Three ways this can land, in order, and the order is the security-relevant
// part:
//
//   1. We have seen this directory subject before. Matched on
//      (tenant, integration, externalRef) — never on the email, because a
//      directory can change an address, and an account matched on a mutable
//      value is an account somebody else can be handed by renaming theirs.
//   2. The address already exists here as a password account. Adopted: this
//      is the ordinary case at a first federation, where people have been
//      using the product for weeks before their IT department connects it.
//   3. Nobody. Provisioned as a MEMBER with no locations at all.
//
// Every lookup is scoped to the tenant resolved from the URL before any of
// this ran. An unscoped subject lookup would let one customer's identity
// provider mint a session for another customer's user, which is the single
// worst thing that could go wrong on this path.

export type ResolvedUser =
  | { ok: true; userId: string; tenantId: string }
  | { ok: false; reason: string };

export async function resolveFederatedUser(params: {
  tenantId: string;
  integrationId: string;
  connectionId: string;
  identity: FederatedIdentity;
}): Promise<ResolvedUser> {
  const { tenantId, integrationId, connectionId, identity } = params;
  const email = identity.email.trim().toLowerCase();

  const bySubject = await db.internalUser.findFirst({
    where: { tenantId, sourceIntegrationId: integrationId, externalRef: identity.subject },
  });

  if (bySubject) {
    if (bySubject.status === "DEACTIVATED") {
      return {
        ok: false,
        reason:
          "That account has been deactivated here. Ask an owner in your organization to add you back.",
      };
    }
    // The directory owns the address and the display name. Keeping them in
    // step on sign-in matters because they are what the chase email is
    // addressed to and what suppliers see as the buyer's name.
    if (bySubject.email !== email || (identity.name && bySubject.name !== identity.name)) {
      const clash = await db.internalUser.findFirst({
        where: { tenantId, email, id: { not: bySubject.id } },
        select: { id: true },
      });
      if (!clash) {
        await db.internalUser.update({
          where: { id: bySubject.id },
          data: { email, name: identity.name ?? bySubject.name },
        });
      }
      // A clash means two people in this organization would end up sharing an
      // address. Signing in still works — refusing would lock somebody out
      // over somebody else's rename — but the stale address is left alone and
      // the collision is recorded rather than resolved by guessing.
      if (clash) {
        await recordDirectoryEvent({
          tenantId,
          connectionId,
          kind: "OPERATION_REFUSED",
          internalUserId: bySubject.id,
          subjectHint: email,
          reason: "Another account in this organization already uses that address.",
          detail: { operation: "sync-email-on-signin" },
        });
      }
    }
    return { ok: true, userId: bySubject.id, tenantId };
  }

  const byEmail = await db.internalUser.findUnique({
    where: { tenantId_email: { tenantId, email } },
  });

  if (byEmail) {
    if (byEmail.status === "DEACTIVATED") {
      return {
        ok: false,
        reason:
          "That account has been deactivated here. Ask an owner in your organization to add you back.",
      };
    }
    await db.internalUser.update({
      where: { id: byEmail.id },
      data: {
        sourceIntegrationId: integrationId,
        externalRef: identity.subject,
        // The password goes. Leaving it would keep a second, unmanaged way
        // into an account the directory now controls — so disabling somebody
        // at the identity provider would not actually disable them.
        passwordHash: null,
        name: identity.name ?? byEmail.name,
        // The role is *not* touched. Adoption is a change of how somebody
        // signs in, not a change of what they are allowed to do.
      },
    });
    await recordDirectoryEvent({
      tenantId,
      connectionId,
      kind: "USER_ADOPTED",
      internalUserId: byEmail.id,
      subjectHint: email,
      detail: { via: "sign-in", integrationId },
    });
    return { ok: true, userId: byEmail.id, tenantId };
  }

  // Provisioned on first sign-in. MEMBER, and no locations: src/lib/access.ts
  // gives an unassigned MEMBER an empty board, which is the right default —
  // being able to sign in is not being given somebody's purchase orders. An
  // owner assigns locations, or a mapped directory group does.
  const created = await db.internalUser.create({
    data: {
      tenantId,
      email,
      name: identity.name ?? email,
      role: "MEMBER",
      passwordHash: null,
      sourceIntegrationId: integrationId,
      externalRef: identity.subject,
    },
  });
  await recordDirectoryEvent({
    tenantId,
    connectionId,
    kind: "USER_CREATED",
    internalUserId: created.id,
    subjectHint: email,
    detail: { via: "sign-in", integrationId },
  });
  return { ok: true, userId: created.id, tenantId };
}
