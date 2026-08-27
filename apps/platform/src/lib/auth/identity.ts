import "server-only";
import { db } from "@/lib/db";
import { recordDirectoryEvent } from "@/lib/directory/audit";
import type { FederatedIdentity } from "@/lib/integrations/idp-contract";

// A known subject is matched on (tenant, integration, externalRef) and never
// on the email: a directory can change an address, and an account matched on a
// mutable value is one somebody else can be handed by renaming theirs.

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
      // Signing in still works — refusing would lock somebody out over
      // somebody else's rename — so the stale address is left and recorded.
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
        // Leaving a password would keep a second, unmanaged way into an
        // account the directory now controls.
        passwordHash: null,
        name: identity.name ?? byEmail.name,
        // The role is deliberately not touched: adoption changes how somebody
        // signs in, not what they are allowed to do.
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

  // MEMBER with no locations: being able to sign in is not being given
  // somebody's purchase orders.
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
