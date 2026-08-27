import "server-only";
import { db } from "@/lib/db";
import { recordDirectoryEvent } from "./audit";
import type { PrismaClient } from "@/generated/prisma/client";

export type GrantOutcome = {
  role: "OWNER" | "MEMBER" | null;
  locationsAdded: number;
  locationsRemoved: number;
};

export async function setGroupMapping(params: {
  db?: PrismaClient;
  tenantId: string;
  groupId: string;
  role: "MEMBER" | null;
  locationIds: string[];
  connectionId?: string | null;
}): Promise<{ ok: true } | { ok: false; refused: string }> {
  const client = params.db ?? db;

  const group = await client.directoryGroup.findFirst({
    where: { id: params.groupId, tenantId: params.tenantId },
  });
  if (!group) return { ok: false, refused: "No such group." };

  if ((params.role as string) === "OWNER") {
    const refused =
      "A directory group can't grant owner. Owner can store ERP credentials and issue " +
      "directory tokens, so it is granted by a person here, not by a group name elsewhere.";
    await recordDirectoryEvent({
      db: client,
      tenantId: params.tenantId,
      connectionId: params.connectionId ?? group.connectionId,
      kind: "OPERATION_REFUSED",
      subjectHint: group.displayName,
      reason: refused,
      detail: { operation: "map-group-role", requested: "OWNER" },
    });
    return { ok: false, refused };
  }

  const unique = [...new Set(params.locationIds)];
  if (unique.length > 0) {
    const found = await client.location.findMany({
      where: { id: { in: unique }, tenantId: params.tenantId },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      return { ok: false, refused: "One of those locations isn't in your organization." };
    }
  }

  await client.directoryGroup.update({
    where: { id: group.id },
    data: { mappedRole: params.role },
  });
  await client.directoryGroupLocation.deleteMany({ where: { groupId: group.id } });
  for (const locationId of unique) {
    await client.directoryGroupLocation.create({ data: { groupId: group.id, locationId } });
  }

  await recordDirectoryEvent({
    db: client,
    tenantId: params.tenantId,
    connectionId: params.connectionId ?? group.connectionId,
    kind: "GROUP_UPDATED",
    subjectHint: group.displayName,
    detail: { mappedRole: params.role, locationIds: unique },
  });

  await recomputeForGroup({ db: client, tenantId: params.tenantId, groupId: group.id });
  return { ok: true };
}

export async function recomputeForGroup(params: {
  db?: PrismaClient;
  tenantId: string;
  groupId: string;
}): Promise<void> {
  const client = params.db ?? db;
  const members = await client.directoryGroupMember.findMany({
    where: { groupId: params.groupId },
    select: { internalUserId: true },
  });
  for (const member of members) {
    await applyGrants({ db: client, tenantId: params.tenantId, internalUserId: member.internalUserId });
  }
}

export async function applyGrants(params: {
  db?: PrismaClient;
  tenantId: string;
  internalUserId: string;
}): Promise<GrantOutcome> {
  const client = params.db ?? db;

  const user = await client.internalUser.findFirst({
    where: { id: params.internalUserId, tenantId: params.tenantId },
    select: { id: true, role: true, status: true },
  });
  if (!user) return { role: null, locationsAdded: 0, locationsRemoved: 0 };

  const memberships = await client.directoryGroupMember.findMany({
    where: { internalUserId: user.id, group: { tenantId: params.tenantId } },
    select: {
      group: {
        select: { id: true, mappedRole: true, locations: { select: { locationId: true } } },
      },
    },
  });

  const mapped = memberships.map((m) => m.group).filter((g) => g.mappedRole !== null);

  const wanted = new Map<string, string>();
  for (const group of mapped) {
    for (const { locationId } of group.locations) {
      if (!wanted.has(locationId)) wanted.set(locationId, group.id);
    }
  }

  const existing = await client.internalUserLocation.findMany({
    where: { internalUserId: user.id },
  });

  let locationsRemoved = 0;
  for (const row of existing) {
    if (row.source !== "DIRECTORY") continue; // a manual grant is never revoked by a directory push
    if (wanted.has(row.locationId)) continue;
    await client.internalUserLocation.delete({ where: { id: row.id } });
    locationsRemoved++;
  }

  let locationsAdded = 0;
  for (const [locationId, groupId] of wanted) {
    const already = existing.find((row) => row.locationId === locationId);
    if (already) {
      continue;
    }
    await client.internalUserLocation.create({
      data: { internalUserId: user.id, locationId, source: "DIRECTORY", grantedByGroupId: groupId },
    });
    locationsAdded++;
  }

  let role: "OWNER" | "MEMBER" | null = null;
  if (user.role !== "OWNER" && mapped.some((g) => g.mappedRole === "MEMBER")) {
    role = "MEMBER";
  }

  return { role, locationsAdded, locationsRemoved };
}
