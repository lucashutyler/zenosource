"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentInternalUser } from "@/lib/dal";
import { runReminderJob } from "@/lib/reminders";
import { getEmailSender, isMailboxActive } from "@/lib/email/sender";

// On-demand trigger for the reminder job, exposed on the dev mailbox page so
// digests can be generated without leaving the app. Only allowed while the
// mailbox is active: with a real provider configured, this button would send
// actual email across every tenant, so it's disabled along with the page.
export async function runRemindersNow() {
  await getCurrentInternalUser();
  if (!isMailboxActive()) return;

  // Same source as scripts/send-reminders.ts — deliberately NOT derived from
  // the request's Host header: a spoofed Host/Origin pair would bake an
  // attacker-controlled origin into every captured /a/{token} link, turning
  // the mailbox into a token-exfiltration surface the first time someone
  // clicks one.
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";

  await runReminderJob({ db, sender: getEmailSender(db), baseUrl });
  revalidatePath("/dashboard/emails");
}
