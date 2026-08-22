import "server-only";
import { db } from "@/lib/db";
import { recordDirectoryEvent } from "./audit";
import type { PrismaClient } from "@/generated/prisma/client";

// What membership of a pushed group is allowed to grant, and how a grant is
// withdrawn again.
//
// Two rules, and both exist because the alternative is a privilege escalation
// that nobody in this product can see happening:
//
//   1. **A group may never grant OWNER.** src/app/actions/integrations.ts
//      calls OWNER "a strictly larger permission than anything else in the
//      product" — it stores ERP service-account credentials, it issues these
//      directory tokens, it disconnects integrations. Somebody renaming a
//      group in their own identity provider's console must not be able to
//      reach any of that. A mapping that asks for it is refused in code, not
//      merely absent from the form, and the refusal is recorded.
//
//   2. **A hand-made grant always wins.** `@@unique([internalUserId,
//      locationId])` means one row cannot carry both provenances, so the
//      precedence has to be decided rather than emerge. A directory push
//      never overwrites or revokes a MANUAL row: an owner who assigned
//      somebody to a site by hand did so for a reason nobody will remember to
//      recreate, and losing it silently is how a buyer's board empties
//      overnight.
//
// An unmapped group grants nothing at all. Pushing a group is a customer
// telling us it exists; mapping it is an owner here deciding what it means.

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

  // Rule 1, enforced where it cannot be bypassed by a crafted request.
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

  // Never trust location ids from a form — the same rule
  // src/lib/access.ts#allLocationsBelongToTenant states for PO and RFQ lines.
  // A location from another tenant attached here would put that tenant's site
  // name on this one's screens and grant access across the boundary.
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

  // A mapping made on Tuesday has to reach Monday's members, or an owner maps
  // a group, sees nothing change, and maps it again.
  await recomputeForGroup({ db: client, tenantId: params.tenantId, groupId: group.id });
  return { ok: true };
}

/** Everyone in one group, after that group's meaning changed. */
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

/**
 * Recompute one person's directory-granted access from scratch.
 *
 * Deliberately a full recompute rather than a diff. Membership changes arrive
 * as adds and removes, mappings change independently of membership, and a
 * group can be deleted outright — three sources of drift, and reconciling them
 * incrementally is how somebody ends up holding a site nobody meant them to
 * have. Recomputing is a handful of queries and is always right.
 */
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

  // Which location each mapped group grants, and which group granted it — the
  // second half matters because withdrawing a grant has to withdraw only the
  // rows the group that stopped applying had issued.
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
    if (row.source !== "DIRECTORY") continue; // rule 2: a manual grant stands
    if (wanted.has(row.locationId)) continue;
    await client.internalUserLocation.delete({ where: { id: row.id } });
    locationsRemoved++;
  }

  let locationsAdded = 0;
  for (const [locationId, groupId] of wanted) {
    const already = existing.find((row) => row.locationId === locationId);
    if (already) {
      // A manual grant that a group now also implies stays manual, so
      // unmapping the group later cannot take it away.
      continue;
    }
    await client.internalUserLocation.create({
      data: { internalUserId: user.id, locationId, source: "DIRECTORY", grantedByGroupId: groupId },
    });
    locationsAdded++;
  }

  // Role: MEMBER if any mapped group says so, and never a demotion of an
  // existing OWNER. An owner who also happens to be in a pushed group must not
  // lose the product's largest permission because of a group's mapping.
  let role: "OWNER" | "MEMBER" | null = null;
  if (user.role !== "OWNER" && mapped.some((g) => g.mappedRole === "MEMBER")) {
    role = "MEMBER";
  }

  return { role, locationsAdded, locationsRemoved };
}
