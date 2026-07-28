import type { PrismaClient } from "@/generated/prisma/client";
import type { EmailSender } from "@/lib/email/sender";
import { ACTION_LABELS } from "@/lib/action-labels";

// Daily reminder job — docs/architecture.md#action-items--reminders. Takes
// db/sender/baseUrl as params rather than importing the app's singletons
// directly, so this runs identically from the Next.js app (a future admin
// action or API route), a standalone script (scripts/send-reminders.ts),
// or a test with an injected fake sender and a test database.
export async function runReminderJob(params: {
  db: PrismaClient;
  sender: EmailSender;
  baseUrl: string;
}): Promise<{ internalEmailsSent: number; externalEmailsSent: number }> {
  const { db, sender, baseUrl } = params;

  const openItems = await db.actionItem.findMany({
    where: { status: "OPEN" },
    include: {
      tenant: true,
      internalOwner: true,
      externalOwner: { include: { supplier: true } },
    },
    orderBy: { openedAt: "asc" },
  });

  const internalGroups = new Map<string, typeof openItems>();
  const externalGroups = new Map<string, typeof openItems>();

  for (const item of openItems) {
    if (item.ownerType === "INTERNAL_USER" && item.internalOwnerId) {
      const group = internalGroups.get(item.internalOwnerId) ?? [];
      group.push(item);
      internalGroups.set(item.internalOwnerId, group);
    } else if (item.ownerType === "EXTERNAL_USER" && item.externalOwnerId) {
      const group = externalGroups.get(item.externalOwnerId) ?? [];
      group.push(item);
      externalGroups.set(item.externalOwnerId, group);
    }
  }

  let internalEmailsSent = 0;
  for (const items of internalGroups.values()) {
    const owner = items[0].internalOwner;
    if (!owner) continue;
    const lines = items.map((i) => `- ${ACTION_LABELS[i.actionType] ?? i.actionType}`);
    await sender.send({
      to: owner.email,
      subject: `${items.length} open item${items.length === 1 ? "" : "s"} on ZenoSource`,
      text: `${lines.join("\n")}\n\nReview them: ${baseUrl}/dashboard`,
    });
    internalEmailsSent++;
  }

  let externalEmailsSent = 0;
  for (const items of externalGroups.values()) {
    const owner = items[0].externalOwner;
    if (!owner) continue;
    const tenantName = items[0].tenant.name;
    const lines = items.map(
      (i) => `- ${ACTION_LABELS[i.actionType] ?? i.actionType}: ${baseUrl}/a/${i.accessToken}`
    );
    await sender.send({
      to: owner.email,
      subject: `${items.length} open item${items.length === 1 ? "" : "s"} with ${tenantName}`,
      text: lines.join("\n"),
    });
    externalEmailsSent++;
  }

  return { internalEmailsSent, externalEmailsSent };
}
