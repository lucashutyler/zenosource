import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { isMailboxActive } from "@/lib/email/sender";
import { runRemindersNow } from "@/app/actions/emails";
import { Card, PageHeader, SubmitButton } from "@/components/ui";

// Dev mailbox: renders email captured by MailboxEmailSender instead of being
// delivered, so the no-login action links are clickable end to end without a
// real provider. Deliberately not tenant-scoped (it simulates the mail
// server) — acceptable only because the page 404s the moment EMAIL_PROVIDER
// is configured, i.e. anywhere that isn't a dev/demo environment.
export default async function EmailsPage() {
  if (!isMailboxActive()) notFound();
  await getCurrentInternalUser();

  const emails = await db.capturedEmail.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div>
      <PageHeader
        title="Emails (dev)"
        subtitle="No email provider is configured, so outbound email is captured here instead of being delivered. Setting EMAIL_PROVIDER disables this page."
        action={
          <form action={runRemindersNow}>
            <SubmitButton variant="secondary">Run reminder job</SubmitButton>
          </form>
        }
      />

      {emails.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nothing captured yet. Run the reminder job to generate a digest for every open action
          item.
        </p>
      ) : (
        <Card>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {emails.map((email) => (
              <li key={email.id}>
                <Link
                  href={`/dashboard/emails/${email.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-50">
                      {email.subject}
                    </p>
                    <p className="truncate text-xs text-zinc-500">to {email.toEmail}</p>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {email.createdAt.toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
