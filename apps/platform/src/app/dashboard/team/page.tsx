import type { Metadata } from "next";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { plural } from "@/lib/format";
import { Callout, Ledger, PageHeader, Panel, Section, Th } from "@/components/ui";
import { AddTeamMemberForm } from "./add-member-form";
import { TeamMemberRow } from "./member-row";
import { ChangeOwnPasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Team" };

/**
 * Team management, which did not exist at all.
 *
 * A buyer organization could not onboard its second procurement person: no
 * invite, no create, no role change, no deactivate, no password reset. The
 * seeded users were the only users a tenant would ever have, and a forgotten
 * password was permanent lockout with no recovery path inside the product.
 */
export default async function TeamPage() {
  const user = await getCurrentInternalUser();
  const isOwner = user.role === "OWNER";

  const members = await db.internalUser.findMany({
    // Active only. Somebody who has been stepped down — by an owner here or by
    // the organization's directory — is not on the team, and listing them
    // would put them in the successor dropdown as a candidate to hand work to.
    // Their row stays (every order they issued points at it) and what happened
    // is in DirectoryEvent; this page is "who is here now".
    where: { tenantId: user.tenantId, status: "ACTIVE" },
    include: {
      _count: { select: { actionItems: { where: { status: "OPEN" } } } },
      locations: { include: { location: { select: { name: true } } } },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  const owners = members.filter((m) => m.role === "OWNER").length;

  return (
    <div>
      <PageHeader
        title="Team"
        meta="Who can sign in, what they can see, and who picks up their work when they're out."
      />

      {isOwner && owners === 1 && (
        <div className="mb-6">
          <Callout title="One owner">
            You&apos;re the only owner. Nobody else can add locations, manage this list, or reset a
            password — and if a supplier rejects an order, every one of those reviews lands on you
            by default.
          </Callout>
        </div>
      )}

      <Section title="People">
        <Ledger caption="Team members">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th width="16rem">Sees</Th>
              <Th align="right" width="7rem">
                Open items
              </Th>
              <Th width="7rem">Role</Th>
              {isOwner && <Th width="16rem" />}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <TeamMemberRow
                key={member.id}
                member={{
                  id: member.id,
                  name: member.name,
                  email: member.email,
                  role: member.role,
                  openCount: member._count.actionItems,
                  locationNames: member.locations.map((l) => l.location.name),
                }}
                isSelf={member.id === user.id}
                viewerIsOwner={isOwner}
                lastOwner={member.role === "OWNER" && owners === 1}
                successors={members
                  .filter((m) => m.id !== member.id)
                  .map((m) => ({ id: m.id, name: m.name }))}
              />
            ))}
          </tbody>
        </Ledger>
      </Section>

      {isOwner && (
        <Section
          title="Add someone"
          description="They can sign in immediately with the password you set. Members see only the locations you assign them; owners see everything."
        >
          <Panel className="p-4">
            <AddTeamMemberForm />
          </Panel>
        </Section>
      )}

      <Section title="Your own password">
        <Panel className="p-4">
          <ChangeOwnPasswordForm />
        </Panel>
      </Section>

      {!isOwner && (
        <p className="text-sm text-ink-faint">
          {members.length} {plural(members.length, "person", "people")} on the team. Owners manage
          who&apos;s on it.
        </p>
      )}
    </div>
  );
}
