import "server-only";
import { db as defaultDb } from "@/lib/db";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DirectoryEventKind } from "@/generated/prisma/enums";

export type DirectoryEventInput = {
  tenantId: string;
  connectionId?: string | null;
  kind: DirectoryEventKind;
  internalUserId?: string | null;
  /** An address or a group name, so a row still says who it was about. */
  subjectHint?: string | null;
  /** For a refusal: the sentence the directory was given. */
  reason?: string | null;
  detail?: Record<string, unknown> | null;
  db?: PrismaClient;
};

export async function recordDirectoryEvent(input: DirectoryEventInput): Promise<void> {
  const client = input.db ?? defaultDb;
  await client.directoryEvent.create({
    data: {
      tenantId: input.tenantId,
      connectionId: input.connectionId ?? null,
      kind: input.kind,
      internalUserId: input.internalUserId ?? null,
      subjectHint: input.subjectHint ?? null,
      reason: input.reason ?? null,
      detail: (input.detail ?? undefined) as never,
    },
  });
}
