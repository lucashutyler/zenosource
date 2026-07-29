import type { PrismaClient } from "@/generated/prisma/client";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

// No provider chosen yet (docs/todo.md open questions). Everything that
// sends email — right now just the reminder job — depends only on the
// EmailSender interface above, so swapping in a real provider later (SES,
// Postmark, Resend, whatever) is a new class implementing it plus one
// branch in getEmailSender(), not a rewrite of the calling code.
//
// Until then, "sending" captures the message to the CapturedEmail table,
// where /dashboard/emails renders it — action-view links included — so the
// whole external flow is exercisable without a provider. Setting
// EMAIL_PROVIDER disables both this sender and that page.
export class MailboxEmailSender implements EmailSender {
  constructor(private readonly db: PrismaClient) {}

  async send(message: EmailMessage): Promise<void> {
    await this.db.capturedEmail.create({
      data: { toEmail: message.to, subject: message.subject, textBody: message.text },
    });
  }
}

// The dev mailbox is active exactly when no real provider is configured.
export function isMailboxActive(): boolean {
  return !process.env.EMAIL_PROVIDER;
}

export function getEmailSender(db: PrismaClient): EmailSender {
  const provider = process.env.EMAIL_PROVIDER;
  if (!provider) return new MailboxEmailSender(db);
  // Failing loudly beats silently capturing to a mailbox page that a
  // provider-configured deployment expects to be disabled.
  throw new Error(
    `EMAIL_PROVIDER="${provider}" is configured but no sender implements it yet — add one in src/lib/email/sender.ts.`
  );
}
