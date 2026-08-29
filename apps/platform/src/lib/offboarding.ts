import "server-only";
import { db as defaultDb } from "@/lib/db";
import { recordDirectoryEvent } from "@/lib/directory/audit";
import type { PrismaClient } from "@/generated/prisma/client";

export type HandOverResult = { moved: number };

export async function handOverOpenWork(params: {
  db?: PrismaClient;
  fromUserId: string;
  toUserId: string;
  moveLocations: boolean;
}): Promise<HandOverResult> {
  const db = params.db ?? defaultDb;

  const moved = await db.actionItem.updateMany({
    where: { internalOwnerId: params.fromUserId, status: "OPEN" },
    data: { internalOwnerId: params.toUserId },
  });

  if (params.moveLocations) {
    const assignments = await db.internalUserLocation.findMany({
      where: { internalUserId: params.fromUserId },
      select: { locationId: true },
    });
    for (const { locationId } of assignments) {
      await db.internalUserLocation.upsert({
        where: {
          internalUserId_locationId: { internalUserId: params.toUserId, locationId },
        },
        // MANUAL: a grant arriving with somebody's work must survive the next directory push.
        create: { internalUserId: params.toUserId, locationId, source: "MANUAL" },
        update: {},
      });
    }
  }

  await db.internalUserLocation.deleteMany({ where: { internalUserId: params.fromUserId } });

  return { moved: moved.count };
}

export async function pickHandoverOwner(
  db: PrismaClient,
  tenantId: string,
  excludeUserId: string
): Promise<{ id: string; name: string } | null> {
  return db.internalUser.findFirst({
    where: {
      tenantId,
      role: "OWNER",
      status: "ACTIVE",
      id: { not: excludeUserId },
    },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
}

export type DeactivationResult =
  | { ok: true; moved: number; successorName: string | null }
  | { ok: false; refused: string };

export async function deactivateInternalUser(params: {
  db?: PrismaClient;
  userId: string;
  successorId?: string;
  source: "TEAM_PAGE" | "DIRECTORY";
  connectionId?: string | null;
  moveLocations?: boolean;
}): Promise<DeactivationResult> {
  const db = params.db ?? defaultDb;

  const user = await db.internalUser.findUnique({ where: { id: params.userId } });
  if (!user) return { ok: false, refused: "No such user." };
  if (user.status === "DEACTIVATED") {
    // Idempotent: a directory told a repeated deactivation failed retries forever.
    return { ok: true, moved: 0, successorName: null };
  }

  if (user.role === "OWNER") {
    const owners = await db.internalUser.count({
      where: { tenantId: user.tenantId, role: "OWNER", status: "ACTIVE" },
    });
    if (owners <= 1) {
      const refused =
        "That is the last active owner of this organization. Promote someone else first — " +
        "an organization with no owner cannot repair a connection or add anyone back.";
      await recordDirectoryEvent({
        db,
        tenantId: user.tenantId,
        connectionId: params.connectionId ?? null,
        kind: "OPERATION_REFUSED",
        internalUserId: user.id,
        subjectHint: user.email,
        reason: refused,
        detail: { operation: "deactivate", source: params.source },
      });
      return { ok: false, refused };
    }
  }

  const successor = params.successorId
    ? await db.internalUser.findFirst({
        where: { id: params.successorId, tenantId: user.tenantId, status: "ACTIVE" },
        select: { id: true, name: true },
      })
    : await pickHandoverOwner(db, user.tenantId, user.id);

  let moved = 0;
  if (successor) {
    ({ moved } = await handOverOpenWork({
      db,
      fromUserId: user.id,
      toUserId: successor.id,
      moveLocations: params.moveLocations ?? params.source === "TEAM_PAGE",
    }));
  } else {
    // Items stay owned by the departing user: an emptied board hides the refusal.
    await db.internalUserLocation.deleteMany({ where: { internalUserId: user.id } });
    await recordDirectoryEvent({
      db,
      tenantId: user.tenantId,
      connectionId: params.connectionId ?? null,
      kind: "OPERATION_REFUSED",
      internalUserId: user.id,
      subjectHint: user.email,
      reason: "Nobody was available to take over their open items.",
      detail: { operation: "handover", source: params.source },
    });
  }

  await db.internalUser.update({
    where: { id: user.id },
    data: {
      status: "DEACTIVATED",
      deactivatedAt: new Date(),
      // Demoted too, so reactivating never silently restores administrative authority.
      role: "MEMBER",
    },
  });

  await recordDirectoryEvent({
    db,
    tenantId: user.tenantId,
    connectionId: params.connectionId ?? null,
    kind: "USER_DEACTIVATED",
    internalUserId: user.id,
    subjectHint: user.email,
    detail: {
      source: params.source,
      movedItems: moved,
      successorId: successor?.id ?? null,
    },
  });

  return { ok: true, moved, successorName: successor?.name ?? null };
}

export async function reactivateInternalUser(params: {
  db?: PrismaClient;
  userId: string;
  source: "TEAM_PAGE" | "DIRECTORY";
  connectionId?: string | null;
}): Promise<{ ok: true } | { ok: false; refused: string }> {
  const db = params.db ?? defaultDb;
  const user = await db.internalUser.findUnique({ where: { id: params.userId } });
  if (!user) return { ok: false, refused: "No such user." };
  if (user.status === "ACTIVE") return { ok: true };

  await db.internalUser.update({
    where: { id: user.id },
    data: { status: "ACTIVE", deactivatedAt: null },
  });
  await recordDirectoryEvent({
    db,
    tenantId: user.tenantId,
    connectionId: params.connectionId ?? null,
    kind: "USER_REACTIVATED",
    internalUserId: user.id,
    subjectHint: user.email,
    detail: { source: params.source },
  });
  return { ok: true };
}
