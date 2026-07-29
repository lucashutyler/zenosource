"use client";

import { useActionState } from "react";
import { handOverAndDeactivate, resetTeamMemberPassword, setTeamMemberRole } from "@/app/actions/team";
import { ConfirmSubmit, SelectField, TextField } from "@/components/forms";
import { SimpleAction } from "@/components/simple-action";
import { StatusChip, Td } from "@/components/ui";
import { plural } from "@/lib/format";

type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  openCount: number;
  locationNames: string[];
};

export function TeamMemberRow({
  member,
  isSelf,
  viewerIsOwner,
  lastOwner,
  successors,
}: {
  member: Member;
  isSelf: boolean;
  viewerIsOwner: boolean;
  lastOwner: boolean;
  successors: { id: string; name: string }[];
}) {
  const [resetState, resetAction] = useActionState(
    resetTeamMemberPassword.bind(null, member.id),
    undefined
  );
  const [handoverState, handoverAction] = useActionState(
    handOverAndDeactivate.bind(null, member.id),
    undefined
  );

  return (
    <tr>
      <Td>
        <span className="font-medium">{member.name}</span>
        {isSelf && <span className="ml-2 text-xs text-ink-faint">you</span>}
        <span className="block text-ink-soft">{member.email}</span>
        {(resetState?.ok || handoverState?.ok) && (
          <span role="status" className="mt-1 block text-xs text-settled">
            {resetState?.ok ?? handoverState?.ok}
          </span>
        )}
        {(resetState?.error || handoverState?.error) && (
          <span role="alert" className="mt-1 block text-xs font-medium text-age-4">
            {resetState?.error ?? handoverState?.error}
          </span>
        )}
      </Td>
      <Td>
        <span className="text-ink-soft">
          {member.role === "OWNER"
            ? "Every location"
            : member.locationNames.length === 0
              ? "Nothing — no locations assigned"
              : member.locationNames.join(", ")}
        </span>
      </Td>
      <Td align="right" mono>
        {member.openCount || <span className="text-ink-faint">—</span>}
      </Td>
      <Td>
        <StatusChip variant={member.role === "OWNER" ? "live" : "settled"}>
          {member.role === "OWNER" ? "Owner" : "Member"}
        </StatusChip>
      </Td>
      {viewerIsOwner && (
        <Td>
          <div className="flex flex-wrap items-center gap-1">
            {!lastOwner && !isSelf && (
              <SimpleAction
                action={setTeamMemberRole.bind(
                  null,
                  member.id,
                  member.role === "OWNER" ? "MEMBER" : "OWNER"
                )}
                label={member.role === "OWNER" ? "Make a member" : "Make an owner"}
                variant="quiet"
                confirm={
                  member.role === "MEMBER"
                    ? {
                        title: `Make ${member.name} an owner?`,
                        body: "Owners see every location, manage this team, create locations, and reset passwords — including yours.",
                        confirmLabel: "Make them an owner",
                      }
                    : {
                        title: `Step ${member.name} down to member?`,
                        body: "They keep their open items but will only see the locations they're assigned to — which may be none, leaving them with a board they can't open.",
                        confirmLabel: "Step them down",
                      }
                }
              />
            )}

            <form action={resetAction}>
              <ConfirmSubmit
                trigger="Reset password"
                variant="quiet"
                title={`Set a new password for ${member.name}?`}
                body="The old one stops working immediately. You'll need to tell them the new one — there's no email reset flow yet."
                confirmLabel="Set it"
              >
                <TextField
                  label="New password"
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  hint="At least 12 characters."
                  className="mb-0"
                />
              </ConfirmSubmit>
            </form>

            {!isSelf && successors.length > 0 && (
              <form action={handoverAction}>
                <ConfirmSubmit
                  trigger="Hand over and remove"
                  variant="quiet"
                  title={`Remove ${member.name} from the team?`}
                  body={
                    <>
                      {/* "Nothing survives the second person" was a named hole
                          in the plan: an item owned by somebody who left looks
                          fine to everyone else, because every count on the
                          board is scoped to its owner. */}
                      They can no longer sign in. Their{" "}
                      <strong className="text-ink">
                        {member.openCount} open {plural(member.openCount, "item")}
                      </strong>{" "}
                      and their location access move to whoever you pick — otherwise that work goes
                      invisible, because every count on the board is scoped to its owner.
                    </>
                  }
                  confirmLabel="Hand over and remove"
                >
                  <SelectField
                    label="Who picks up their work"
                    name="successorId"
                    required
                    defaultValue=""
                    className="mb-0"
                  >
                    <option value="">Choose someone…</option>
                    {successors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </SelectField>
                </ConfirmSubmit>
              </form>
            )}
          </div>
        </Td>
      )}
    </tr>
  );
}
