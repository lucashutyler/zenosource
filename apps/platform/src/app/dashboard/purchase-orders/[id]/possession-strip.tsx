import { formatDate } from "@/lib/format";
import type { PossessionSegment } from "@/lib/status-events";

/**
 * The order's whole life in one 28px bar —
 * `[1d draft][0.2d you issued][11d them][2d you, open]`.
 *
 * This is the thing nobody else draws. SourceDay's urgency is a `Hot` sticker
 * a human has to remember to apply; Axya's `Late` pill renders one-day-late
 * and forty-days-late identically. Neither can answer "where did the six
 * weeks go", which is the only question anyone asks in a late-order meeting.
 *
 * Segments are proportional to real elapsed time, so a two-hour turnaround is
 * a hairline and an eleven-day silence is a third of the bar. That
 * asymmetry *is* the content — normalizing the widths would make it a pretty
 * chart that says nothing.
 */
export function PossessionStrip({ segments }: { segments: PossessionSegment[] }) {
  const total = segments.reduce((sum, s) => sum + Math.max(s.days, 0), 0);
  if (total <= 0) return null;

  return (
    <figure className="mb-8">
      <figcaption className="mb-2 flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        <span>Where the time went</span>
        <span className="font-mono normal-case tracking-normal">
          {total < 1 ? "under a day" : `${Math.round(total)} days total`}
        </span>
      </figcaption>

      <div className="flex h-7 w-full overflow-hidden border border-rule" role="img" aria-label={describe(segments)}>
        {segments.map((segment, i) => {
          // A zero-width segment is a lie of omission — a same-minute
          // transition still happened. Floor at a visible hairline.
          const width = Math.max((Math.max(segment.days, 0) / total) * 100, 0.8);
          return (
            <div
              key={i}
              style={{ width: `${width}%` }}
              title={`${segment.status.toLowerCase()} · ${formatDate(segment.from)} → ${formatDate(segment.to)} · ${segment.days < 1 ? "under a day" : `${Math.round(segment.days)}d`}`}
              className={
                segment.court === "SUPPLIER"
                  ? "bg-court-them"
                  : segment.court === "BUYER"
                    ? "bg-ink-faint"
                    : "bg-rule"
              }
            />
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        <Key className="bg-ink-faint" label="Us" />
        <Key className="bg-court-them" label="Them" />
        <Key className="bg-rule" label="Settled" />
      </div>
    </figure>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 ${className}`} aria-hidden />
      {label}
    </span>
  );
}

/** The bar, as a sentence, for anyone not looking at it. */
function describe(segments: PossessionSegment[]): string {
  return segments
    .map((s) => {
      const who = s.court === "SUPPLIER" ? "supplier" : s.court === "BUYER" ? "us" : "nobody";
      const time = s.days < 1 ? "under a day" : `${Math.round(s.days)} days`;
      return `${s.status.toLowerCase()} with ${who} for ${time}`;
    })
    .join(", then ");
}
