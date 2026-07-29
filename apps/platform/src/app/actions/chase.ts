"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentInternalUser } from "@/lib/dal";
import { runReminderJob, describeChaseResult } from "@/lib/reminders";
import { getEmailSender } from "@/lib/email/sender";
import { sendActionLink } from "@/lib/email/notify";
import type { FormState } from "@/lib/form-state";

/**
 * `Chase all N` — one button at the masthead, aggregating by recipient.
 *
 * Deliberately not a per-row nudge. A supplier with six open lines across
 * three orders would receive six emails from six clicks, on the most widely
 * distributed surface we own, and the result is our domain in their spam
 * filter — which silently ends every chase we will ever send them.
 * `runReminderJob` already groups by recipient; this reuses it rather than
 * forking a second send path, and inherits its 24-hour server-side cooldown.
 */
export async function chaseAll(): Promise<FormState> {
  const user = await getCurrentInternalUser();

  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const result = await runReminderJob({
    db,
    sender: getEmailSender(db),
    baseUrl,
    tenantId: user.tenantId,
    externalOnly: true,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/emails");
  return { ok: describeChaseResult(result) };
}

/**
 * Resend one supplier's link from the buyer side.
 *
 * "I never got it" is the single most common thing a supplier says, and
 * before this the buyer had no answer and no way to try again — the link
 * existed only in an email nobody on our side could see or resend.
 */
export async function resendActionLink(actionItemId: string): Promise<FormState> {
  const user = await getCurrentInternalUser();

  const item = await db.actionItem.findFirst({
    where: { id: actionItemId, tenantId: user.tenantId, status: "OPEN" },
    include: { externalOwner: true },
  });
  if (!item?.externalOwner) return { error: "That item is no longer open." };

  await sendActionLink({ actionItemId });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/emails");
  return { ok: `Resent to ${item.externalOwner.email}.` };
}
