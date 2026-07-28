import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type {
  ActionItemOwnerType,
  ActionItemSubjectType,
  ActionItemType,
} from "@/generated/prisma/enums";

function generateAccessToken() {
  return randomBytes(32).toString("hex");
}

// Every state-bearing entity resolves to at most one open ActionItem — see
// docs/architecture.md#action-items--reminders. Callers should only ever
// create one through a state transition, never freestanding.
export async function createActionItem(params: {
  tenantId: string;
  subjectType: ActionItemSubjectType;
  subjectId: string;
  actionType: ActionItemType;
  ownerType: ActionItemOwnerType;
  internalOwnerId?: string;
  externalOwnerId?: string;
}) {
  return db.actionItem.create({
    data: {
      tenantId: params.tenantId,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      actionType: params.actionType,
      ownerType: params.ownerType,
      internalOwnerId: params.internalOwnerId,
      externalOwnerId: params.externalOwnerId,
      accessToken: generateAccessToken(),
    },
  });
}

export async function resolveActionItem(id: string) {
  return db.actionItem.update({
    where: { id },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
}

export function countOpenActionItemsForInternalUser(internalUserId: string) {
  return db.actionItem.count({
    where: { internalOwnerId: internalUserId, status: "OPEN" },
  });
}

export function listOpenActionItemsForInternalUser(internalUserId: string) {
  return db.actionItem.findMany({
    where: { internalOwnerId: internalUserId, status: "OPEN" },
    orderBy: { openedAt: "asc" },
  });
}

// The scoped, no-login "action view" link — see docs/architecture.md
// #action-items--reminders. Valid as long as the item stays OPEN; not
// single-use, not separately time-limited.
export function findOpenActionItemByToken(accessToken: string) {
  return db.actionItem.findFirst({
    where: { accessToken, status: "OPEN" },
    include: { externalOwner: { include: { supplier: true } } },
  });
}
