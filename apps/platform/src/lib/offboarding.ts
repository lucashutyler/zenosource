import "server-only";
import { db as defaultDb } from "@/lib/db";
import { recordDirectoryEvent } from "@/lib/directory/audit";
import type { PrismaClient } from "@/generated/prisma/client";

// Somebody leaving, and their work not leaving with them.
//
// "Nothing survives the second person" was a named hole in docs/todo.md: an
// item owned by someone who left looks fine to everyone else, because every
// count on the board is scoped to its owner. Phase 1b closed it for the case
// where an owner clicks a button and names a successor. Phase 3 has to close
// it for the case where a directory says so at 3am and there is nobody to ask
// — which is the case that actually happens.
//
// Both go through here, so there is one implementation with two policies
// rather than two implementations that drift. Takes `db` as a parameter for
// the same reason runReminderJob and runSync do: it has to run identically
// from a server action, from an inbound directory request, and from a test.

export type HandOverResult = { moved: number };

/**
 * Move every open item from one person to another.
 *
 * `moveLocations` is the whole difference between the two callers. When an
 * owner names a successor, the successor needs the departing user's location
 * assignments or they inherit items for orders they cannot open. When a
 * *directory* triggers this, copying locations would be a privilege grant
 * issued by an offboarding — so the work goes to an OWNER instead, who is
 * unrestricted by construction (locationScopeFor returns undefined for
 * OWNER, src/lib/access.ts) and can therefore resolve anything.
 */
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
        // A grant that arrives with somebody's work is a hand-made one, and
        // must not be revoked by the next directory push.
        create: { internalUserId: params.toUserId, locationId, source: "MANUAL" },
        update: {},
      });
    }
  }

  await db.internalUserLocation.deleteMany({ where: { internalUserId: params.fromUserId } });

  return { moved: moved.count };
}

/** Who a directory-triggered handover goes to when nobody is there to choose. */
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
    // Oldest first, so the same person is chosen every time rather than
    // whoever the planner happened to return.
    orderBy: { createdAt: "asc" },
  });
}

export type DeactivationResult =
  | { ok: true; moved: number; successorName: string | null }
  | { ok: false; refused: string };

/**
 * Step someone out of the team, wherever the instruction came from.
 *
 * Refuses the last active owner. That refusal is not politeness — an
 * organization with no owner cannot repair a broken integration, cannot issue
 * a directory token, and cannot promote anyone, so the directory would have
 * locked its own customer out of administering the product. It is recorded as
 * an OPERATION_REFUSED event because nothing else in the product would say it
 * happened.
 */
export async function deactivateInternalUser(params: {
  db?: PrismaClient;
  userId: string;
  /** Named by an owner; otherwise the tenant's oldest active owner is chosen. */
  successorId?: string;
  source: "TEAM_PAGE" | "DIRECTORY";
  connectionId?: string | null;
  moveLocations?: boolean;
}): Promise<DeactivationResult> {
  const db = params.db ?? defaultDb;

  const user = await db.internalUser.findUnique({ where: { id: params.userId } });
  if (!user) return { ok: false, refused: "No such user." };
  if (user.status === "DEACTIVATED") {
    // Idempotent: a directory retrying a deactivation it already made must
    // not be told it failed, or it retries forever.
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
    // No one to hand to. Still strip the location grants — a deactivated user
    // holding a site's orders is the thing being prevented — and leave the
    // items where they are rather than dropping them, so the refusal is
    // visible on the board rather than silently emptying it.
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
      // Demoted as well as deactivated, so reactivating never silently
      // restores administrative authority somebody removed on purpose.
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

/**
 * A directory can undo an offboarding, and does — somebody suspended by
 * mistake, or a contractor coming back. The role deliberately does not come
 * back with them: MEMBER is where deactivation left it, and an owner has to
 * say otherwise.
 */
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
