import "server-only";
import { db as defaultDb } from "@/lib/db";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DirectoryEventKind } from "@/generated/prisma/enums";

// Every directory operation goes through here, applied and refused alike.
//
// Same discipline as src/lib/status-events.ts: one writer, so the record
// cannot drift from the thing it records. The refusals are the reason this
// exists — a last-owner deactivation we correctly declined writes no status
// anywhere else in the product, and it is exactly what Phase 5's "security
// review of multi-tenant auth boundaries ... SCIM token scoping in
// particular" reads.
//
// `detail` carries canonical fields written by callers here, never a request
// body handed over by an integration. The boundary rule
// (docs/integrations.md: don't leak vendor-specific shapes into core platform
// code) does not get an exception for an audit table.

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
