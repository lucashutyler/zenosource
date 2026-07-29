import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { isMailboxActive } from "@/lib/email/sender";
import { formatDateTime } from "@/lib/format";
import { MetaList, PageHeader, Panel, Section } from "@/components/ui";

export const metadata: Metadata = { title: "Captured email" };

// Bodies are plain text; URLs (the /a/{token} action links in particular)
// become clickable so the external flow can be exercised straight from the
// captured email.
function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} className="text-court-them underline">
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
      <PageHeader
        back={{ href: "/dashboard/emails", label: "All outbound email" }}
        eyebrow="Captured email"
        title={email.subject}
        meta={
          <MetaList>
            {[
              <span key="t">to {email.toEmail}</span>,
              <span key="f">from {email.fromName}</span>,
              email.replyTo ? <span key="r">reply → {email.replyTo}</span> : null,
              <span key="d" className="font-mono">
                {formatDateTime(email.createdAt)}
              </span>,
            ].filter(Boolean) as React.ReactNode[]}
          </MetaList>
        }
      />

      {email.previewText && (
        <Panel className="mb-6 px-4 py-2.5 text-sm">
          <span className="text-ink-faint">Preview line: </span>
          <span className="text-ink">{email.previewText}</span>
        </Panel>
      )}

      {email.htmlBody && (
        <Section
          title="As the supplier sees it"
          description="Rendered at 390px — the width most of them will read it at. This screen is what ends the “I never got it” conversation."
        >
          {/* A phone frame, not a full-width preview. The audit found the old
              email view overflowing a 390px viewport by 83% — and email is the
              one surface where the phone is the primary reader, not the
              fallback. Sandboxed: captured HTML is untrusted content and this
              page is authenticated. */}
          <div className="flex justify-center overflow-x-auto">
            <div className="w-[390px] shrink-0 border-2 border-ink bg-white">
              <iframe
                title="Email preview"
                srcDoc={email.htmlBody}
                sandbox=""
                className="h-[720px] w-full"
              />
            </div>
          </div>
        </Section>
      )}

      <Section title="Plain text">
        <Panel className="p-4">
          <pre className="whitespace-pre-wrap font-sans text-sm text-ink">
            {linkify(email.textBody)}
          </pre>
        </Panel>
      </Section>
    </div>
  );
}
