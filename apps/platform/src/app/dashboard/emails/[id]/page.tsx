import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { isMailboxActive } from "@/lib/email/sender";
import { Card, PageHeader } from "@/components/ui";

// Bodies are plain text; URLs (the /a/{token} action links in particular)
// become clickable so the external flow can be exercised straight from the
// captured email.
function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        className="text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-400"
      >
        {part}
      </a>
    ) : (
      part
    )
  );
}

export default async function EmailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isMailboxActive()) notFound();
  await getCurrentInternalUser();

  const { id } = await params;
  const email = await db.capturedEmail.findUnique({ where: { id } });
  if (!email) notFound();

  return (
    <div>
      <Link
        href="/dashboard/emails"
        className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        &larr; All captured emails
      </Link>
      <PageHeader
        title={email.subject}
        subtitle={`to ${email.toEmail} · ${email.createdAt.toLocaleString()}`}
      />
      <Card className="p-4">
        <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-800 dark:text-zinc-200">
          {linkify(email.textBody)}
        </pre>
      </Card>
    </div>
  );
}
