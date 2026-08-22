import "server-only";
import { db as defaultDb } from "@/lib/db";
import { deactivateInternalUser, reactivateInternalUser } from "@/lib/offboarding";
import { recordDirectoryEvent } from "./audit";
import { applyGrants } from "./mapping";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DirectoryStore, DirectoryUser } from "@/lib/integrations/idp-contract";

// Where the directory's tenant boundary is actually enforced.
//
// Every method below closes over one tenantId and one connectionId, taken from
// the token row that authenticated the request, and none of them accepts a
// tenant as an argument. That is the design rather than a convention: there is
// no signature here into which the wrong tenant can be passed, so the breach
// docs/integrations.md warns about — "a bug that lets one tenant's SCIM token
// touch another tenant's users" — has no shape to take.
//
// The connector on the other side of this port never sees a tenant at all. It
// translates a protocol; this decides what is allowed.

export function directoryStoreFor(context: {
  tenantId: string;
  connectionId: string;
  integrationId: string;
  db?: PrismaClient;
}): DirectoryStore {
  const db = context.db ?? defaultDb;
  const { tenantId, connectionId, integrationId } = context;

  const toUser = (row: {
    externalRef: string | null;
    id: string;
    email: string;
    name: string;
    status: string;
  }): DirectoryUser => ({
    externalRef: row.externalRef ?? row.id,
    email: row.email,
    name: row.name,
    active: row.status === "ACTIVE",
  });

  const select = {
    id: true,
    email: true,
    name: true,
    status: true,
    externalRef: true,
  } as const;

  /** Always scoped. Never called with anything but this connection's own key. */
  function findRow(externalRef: string) {
    return db.internalUser.findFirst({
      where: { tenantId, sourceIntegrationId: integrationId, externalRef },
      select,
    });
  }

  return {
    async findUser(externalRef) {
      const row = await findRow(externalRef);
      return row ? toUser(row) : null;
    },

    async findUserByEmail(email) {
      const row = await db.internalUser.findUnique({
        where: { tenantId_email: { tenantId, email: email.trim().toLowerCase() } },
        select,
      });
      return row ? toUser(row) : null;
    },

    async listUsers({ skip, take, email, externalRef }) {
      // Only people this connection provisioned are listed. A password account
      // an owner created by hand is not the directory's to enumerate, and
      // returning it would invite the directory to "reconcile" by deactivating
      // everyone it does not recognise.
      const where = {
        tenantId,
        sourceIntegrationId: integrationId,
        ...(email ? { email: email.trim().toLowerCase() } : {}),
        ...(externalRef ? { externalRef } : {}),
      };
      const [rows, total] = await Promise.all([
        db.internalUser.findMany({
          where,
          select,
          orderBy: { createdAt: "asc" },
          skip: Math.max(0, skip),
          take,
        }),
        db.internalUser.count({ where }),
      ]);
      return { users: rows.map(toUser), total };
    },

    async createUser({ externalRef, email, name }) {
      const address = email.trim().toLowerCase();

      const bySubject = await findRow(externalRef);
      if (bySubject) {
        // A retry of a create that already happened. Idempotent, because a
        // directory that gets an error here retries forever.
        const updated = await db.internalUser.update({
          where: { id: bySubject.id },
          data: { name },
          select,
        });
        return toUser(updated);
      }

      const byEmail = await db.internalUser.findUnique({
        where: { tenantId_email: { tenantId, email: address } },
        select: { ...select, sourceIntegrationId: true },
      });

      if (byEmail) {
        if (byEmail.sourceIntegrationId && byEmail.externalRef !== externalRef) {
          // Two directory records claiming one address. Refused rather than
          // reassigned: whichever way we guessed, one real person would end up
          // signing in as another.
          const refused = "Another directory user in this organization already has that address.";
          await recordDirectoryEvent({
            db,
            tenantId,
            connectionId,
            kind: "OPERATION_REFUSED",
            internalUserId: byEmail.id,
            subjectHint: address,
            reason: refused,
            detail: { operation: "create", externalRef },
          });
          return { refused };
        }

        // The ordinary case at a first federation: somebody who has been using
        // a password account for weeks. Adopted, keeping their role and their
        // history — every purchase order they issued points at this row — and
        // losing the password, so the directory really is in control of access.
        const adopted = await db.internalUser.update({
          where: { id: byEmail.id },
          data: { sourceIntegrationId: integrationId, externalRef, name, passwordHash: null },
          select,
        });
        await recordDirectoryEvent({
          db,
          tenantId,
          connectionId,
          kind: "USER_ADOPTED",
          internalUserId: adopted.id,
          subjectHint: address,
          detail: { via: "provisioning", externalRef },
        });
        return toUser(adopted);
      }

      const created = await db.internalUser.create({
        data: {
          tenantId,
          email: address,
          name,
          role: "MEMBER",
          passwordHash: null,
          sourceIntegrationId: integrationId,
          externalRef,
        },
        select,
      });
      await recordDirectoryEvent({
        db,
        tenantId,
        connectionId,
        kind: "USER_CREATED",
        internalUserId: created.id,
        subjectHint: address,
        detail: { via: "provisioning", externalRef },
      });
      return toUser(created);
    },

    async updateUser(externalRef, patch) {
      const row = await findRow(externalRef);
      if (!row) return { refused: "No such user." };

      if (patch.email && patch.email.trim().toLowerCase() !== row.email) {
        const address = patch.email.trim().toLowerCase();
        const clash = await db.internalUser.findUnique({
          where: { tenantId_email: { tenantId, email: address } },
          select: { id: true },
        });
        if (clash && clash.id !== row.id) {
          // Nothing is mutated on the way to this refusal — a partial apply
          // would leave the name changed and the address not, with the
          // directory told the whole thing failed.
          const refused = "Another user in this organization already has that address.";
          await recordDirectoryEvent({
            db,
            tenantId,
            connectionId,
            kind: "OPERATION_REFUSED",
            internalUserId: row.id,
            subjectHint: address,
            reason: refused,
            detail: { operation: "update-email" },
          });
          return { refused };
        }
      }

      const updated = await db.internalUser.update({
        where: { id: row.id },
        data: {
          ...(patch.email ? { email: patch.email.trim().toLowerCase() } : {}),
          ...(patch.name ? { name: patch.name } : {}),
        },
        select,
      });
      await recordDirectoryEvent({
        db,
        tenantId,
        connectionId,
        kind: "USER_UPDATED",
        internalUserId: updated.id,
        subjectHint: updated.email,
        detail: { fields: Object.keys(patch) },
      });
      return toUser(updated);
    },

    async setUserActive(externalRef, active) {
      const row = await findRow(externalRef);
      if (!row) return { refused: "No such user." };

      if (!active) {
        // Deactivation is never just a flag. Somebody's open items have to go
        // somewhere, and a directory event at 3am has nobody to ask — see
        // src/lib/offboarding.ts, which is the same code the team page uses
        // with a human-named successor instead of the oldest active owner.
        const result = await deactivateInternalUser({
          db,
          userId: row.id,
          source: "DIRECTORY",
          connectionId,
          moveLocations: false,
        });
        if (!result.ok) return { refused: result.refused };
      } else {
        const result = await reactivateInternalUser({
          db,
          userId: row.id,
          source: "DIRECTORY",
          connectionId,
        });
        if (!result.ok) return { refused: result.refused };
        // Whatever their groups mean now, not what they meant when they left.
        await applyGrants({ db, tenantId, internalUserId: row.id });
      }

      const after = await db.internalUser.findUnique({ where: { id: row.id }, select });
      return after ? toUser(after) : { refused: "No such user." };
    },

    async findGroup(externalRef) {
      const group = await db.directoryGroup.findUnique({
        where: { connectionId_externalRef: { connectionId, externalRef } },
        select: { externalRef: true, displayName: true },
      });
      return group ?? null;
    },

    async listGroupMembers(externalRef) {
      const group = await db.directoryGroup.findUnique({
        where: { connectionId_externalRef: { connectionId, externalRef } },
        select: { members: { select: { internalUser: { select } } } },
      });
      return (group?.members ?? []).map((m) => toUser(m.internalUser));
    },

    async listGroups({ skip, take, displayName }) {
      const where = { connectionId, ...(displayName ? { displayName } : {}) };
      const [rows, total] = await Promise.all([
        db.directoryGroup.findMany({
          where,
          select: { externalRef: true, displayName: true },
          orderBy: { createdAt: "asc" },
          skip: Math.max(0, skip),
          take,
        }),
        db.directoryGroup.count({ where }),
      ]);
      return { groups: rows, total };
    },

    async upsertGroup(group) {
      // Created inert: `mappedRole` stays null and no locations are attached,
      // so a group arriving from a directory grants nothing at all until an
      // owner here decides what it means. A group appearing is a customer
      // telling us it exists, not telling us what it entitles anyone to.
      const existing = await db.directoryGroup.findUnique({
        where: { connectionId_externalRef: { connectionId, externalRef: group.externalRef } },
        select: { id: true },
      });
      const row = await db.directoryGroup.upsert({
        where: { connectionId_externalRef: { connectionId, externalRef: group.externalRef } },
        create: {
          tenantId,
          connectionId,
          externalRef: group.externalRef,
          displayName: group.displayName,
        },
        update: { displayName: group.displayName },
        select: { id: true, externalRef: true, displayName: true },
      });
      await recordDirectoryEvent({
        db,
        tenantId,
        connectionId,
        kind: existing ? "GROUP_UPDATED" : "GROUP_CREATED",
        subjectHint: row.displayName,
        detail: { externalRef: row.externalRef },
      });
      return { externalRef: row.externalRef, displayName: row.displayName };
    },

    async deleteGroup(externalRef) {
      const group = await db.directoryGroup.findUnique({
        where: { connectionId_externalRef: { connectionId, externalRef } },
        select: { id: true, displayName: true, members: { select: { internalUserId: true } } },
      });
      if (!group) return;
      const affected = group.members.map((m) => m.internalUserId);

      await db.directoryGroupMember.deleteMany({ where: { groupId: group.id } });
      await db.directoryGroupLocation.deleteMany({ where: { groupId: group.id } });
      await db.directoryGroup.delete({ where: { id: group.id } });

      // Withdraw what this group granted, and only what it granted.
      for (const internalUserId of affected) {
        await applyGrants({ db, tenantId, internalUserId });
      }
      await recordDirectoryEvent({
        db,
        tenantId,
        connectionId,
        kind: "GROUP_DELETED",
        subjectHint: group.displayName,
        detail: { members: affected.length },
      });
    },

    async setGroupMembers(externalRef, memberRefs) {
      const group = await requireGroup(externalRef);
      if (!group) return;
      const ids = await resolveMembers(memberRefs);
      const before = await db.directoryGroupMember.findMany({
        where: { groupId: group.id },
        select: { internalUserId: true },
      });
      await db.directoryGroupMember.deleteMany({ where: { groupId: group.id } });
      for (const internalUserId of ids) {
        await db.directoryGroupMember.create({ data: { groupId: group.id, internalUserId } });
      }
      await recompute([...before.map((m) => m.internalUserId), ...ids], group.displayName, ids.length);
    },

    async addGroupMembers(externalRef, memberRefs) {
      const group = await requireGroup(externalRef);
      if (!group) return;
      const ids = await resolveMembers(memberRefs);
      for (const internalUserId of ids) {
        await db.directoryGroupMember.upsert({
          where: { groupId_internalUserId: { groupId: group.id, internalUserId } },
          create: { groupId: group.id, internalUserId },
          update: {},
        });
      }
      await recompute(ids, group.displayName, ids.length);
    },

    async removeGroupMembers(externalRef, memberRefs) {
      const group = await requireGroup(externalRef);
      if (!group) return;
      const ids = await resolveMembers(memberRefs);
      await db.directoryGroupMember.deleteMany({
        where: { groupId: group.id, internalUserId: { in: ids } },
      });
      await recompute(ids, group.displayName, ids.length);
    },
  };

  async function requireGroup(externalRef: string) {
    return db.directoryGroup.findUnique({
      where: { connectionId_externalRef: { connectionId, externalRef } },
      select: { id: true, displayName: true },
    });
  }

  /**
   * Member identifiers are the directory's, and are resolved inside this
   * tenant. An id belonging to somebody else's organization simply finds
   * nobody — which is the tenant boundary doing its job silently, rather than
   * an error that would tell a caller the id exists somewhere.
   */
  async function resolveMembers(memberRefs: string[]): Promise<string[]> {
    if (memberRefs.length === 0) return [];
    const rows = await db.internalUser.findMany({
      where: {
        tenantId,
        sourceIntegrationId: integrationId,
        externalRef: { in: [...new Set(memberRefs)] },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async function recompute(userIds: string[], groupName: string, changed: number) {
    for (const internalUserId of [...new Set(userIds)]) {
      await applyGrants({ db, tenantId, internalUserId });
    }
    await recordDirectoryEvent({
      db,
      tenantId,
      connectionId,
      kind: "GROUP_MEMBERSHIP_CHANGED",
      subjectHint: groupName,
      detail: { affected: new Set(userIds).size, changed },
    });
  }
}
