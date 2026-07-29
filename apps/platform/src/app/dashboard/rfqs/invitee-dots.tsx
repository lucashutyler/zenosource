import { ageStepSince, formatDwell } from "@/lib/format";

/**
 * One 10px square per invited supplier, filled at *that invitee's own* dwell,
 * hollow once they've answered.
 *
 * An RFQ has one status but N conversations, and a single status pill flattens
 * them: `SENT` reads identically whether four suppliers are two days late or
 * one is three weeks silent while three have already quoted. This is the
 * cheapest possible view of the thing the row is actually about.
 */
export function InviteeDots({
  invites,
  sentAt,
}: {
  invites: {
    id: string;
    status: string;
    respondedAt: Date | null;
    declinedAt: Date | null;
    createdAt: Date;
    supplier: { name: string };
  }[];
  sentAt: Date | null;
}) {
  if (invites.length === 0) {
    return <span className="text-xs text-ink-faint">nobody invited</span>;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {invites.map((invite) => {
        const answered = invite.status !== "INVITED";
        // Dwell runs from when the request actually went out, not from when
        // the draft was created — an RFQ drafted in March and sent in July
        // hasn't been waiting since March.
        const since = sentAt ?? invite.createdAt;
        const step = ageStepSince(since);
        const label = answered
          ? `${invite.supplier.name} — ${invite.status === "DECLINED" ? "declined" : "quoted"}`
          : `${invite.supplier.name} — silent ${formatDwell(since)}`;

        return (
          <span
            key={invite.id}
            title={label}
            aria-label={label}
            role="img"
            className={
              answered
                ? "inline-block h-2.5 w-2.5 border border-rule-strong"
                : `inline-block h-2.5 w-2.5 border age-${step}`
            }
            style={answered ? undefined : { backgroundColor: "currentColor" }}
          />
        );
      })}
    </span>
  );
}
