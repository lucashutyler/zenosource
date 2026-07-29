import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { isMailboxActive } from "@/lib/email/sender";
import { runRemindersNow } from "@/app/actions/emails";
import { formatDateTime } from "@/lib/format";
import { EmptyState, Ledger, PageHeader, Panel, Td, Th } from "@/components/ui";
import { SimpleAction } from "@/components/simple-action";

export const metadata: Metadata = { title: "Emails (dev)" };

// Dev mailbox: renders email captured by MailboxEmailSender instead of being
// delivered, so the no-login action links are clickable end to end without a
// real provider. Deliberately not tenant-scoped (it simulates the mail
// server) — acceptable only because the page 404s the moment EMAIL_PROVIDER
// is configured, i.e. anywhere that isn't a dev/demo environment.
export default async function EmailsPage() {
  if (!isMailboxActive()) notFound();
  await getCurrentInternalUser();

  const emails = await db.capturedEmail.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <PageHeader
        title="Outbound email"
        meta="No provider is configured, so everything the app sends is captured here instead of being delivered. This is also the answer to “I never got it” — you can see exactly what went out."
        actions={
          <SimpleAction
            action={runRemindersNow}
            label="Run the chase now"
            pendingLabel="Chasing…"
          />
        }
      />

      {emails.length === 0 ? (
        <EmptyState
          headline="Nothing sent yet."
          body="Issue a purchase order or send an RFQ and the supplier's email lands here. Or run the chase to generate a digest for everything currently open."
        />
      ) : (
        <Ledger caption="Captured outbound email">
          <thead>
            <tr>
              <Th>Subject</Th>
              <Th width="16rem">To</Th>
              <Th width="14rem">From</Th>
              <Th align="right" width="12rem">
                Sent
              </Th>
            </tr>
          </thead>
          <tbody>
            {emails.map((email) => (
              <tr key={email.id} className="hover:bg-rule/30">
                <Td>
                  <Link
                    href={`/dashboard/emails/${email.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {email.subject}
                  </Link>
                  {email.previewText && (
                    <span className="block text-ink-faint">{email.previewText}</span>
                  )}
                </Td>
                <Td>
                  <span className="text-ink-soft">{email.toEmail}</span>
                </Td>
                <Td>
                  <span className="text-ink-soft">{email.fromName}</span>
                  {email.replyTo && (
                    <span className="block text-xs text-ink-faint">reply → {email.replyTo}</span>
                  )}
                </Td>
                <Td align="right" mono>
                  <span className="text-ink-soft">{formatDateTime(email.createdAt)}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Ledger>
      )}

      <Panel className="mt-6 px-4 py-3 text-sm text-ink-soft">
        Setting <code className="font-mono text-ink">EMAIL_PROVIDER</code> hides this page, disables
        capture, and routes everything through the real sender.
      </Panel>
    </div>
  );
}
