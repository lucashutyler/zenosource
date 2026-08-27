import "server-only";
import { db as defaultDb } from "@/lib/db";
import { deactivateInternalUser, reactivateInternalUser } from "@/lib/offboarding";
import { recordDirectoryEvent } from "./audit";
import { applyGrants } from "./mapping";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DirectoryStore, DirectoryUser } from "@/lib/integrations/idp-contract";

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
      // Only this connection's users: a directory deactivates any it is shown and does not know.
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
        // Idempotent: a directory that gets an error on a repeated create retries forever.
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

        // passwordHash cleared: a second way in would survive being disabled at the directory.
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
        // false: a directory handover must not grant the successor sites nobody assigned them.
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
