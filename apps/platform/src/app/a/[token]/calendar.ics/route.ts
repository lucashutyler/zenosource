import { db } from "@/lib/db";

// The promise date, as a calendar file.
//
// One route, and it puts the buyer's need-by into the shop foreman's own
// calendar — where it will still be on the day, whether or not anybody
// remembers the email. The token is the authorization, exactly as it is for
// the action view itself; this deliberately serves resolved items too, since
// a supplier who just confirmed and then wants the reminder is the main case.

function icsEscape(value: string): string {
  return value.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

function toIcsDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const item = await db.actionItem.findUnique({
    where: { accessToken: token },
    include: { tenant: { select: { name: true } } },
  });
  if (!item || item.subjectType !== "PURCHASE_ORDER") {
    return new Response("Not found", { status: 404 });
  }

  const po = await db.purchaseOrder.findUnique({
    where: { id: item.subjectId },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  if (!po) return new Response("Not found", { status: 404 });

  const due = po.lines
    .map((l) => l.promiseDate ?? l.needByDate)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  if (!due) return new Response("No date on this order", { status: 404 });

  const summary = `${po.number} due — ${item.tenant.name}`;
  const description = po.lines
    .map((l) => `${Number(l.quantity)} ${l.uom} ${l.itemNumber} — ${l.description}`)
    .join("\n");

  // DTSTAMP is required by RFC 5545 and must be a real timestamp; using the
  // order's own updatedAt keeps the file byte-stable for a given order rather
  // than changing on every download, which some clients treat as an edit.
  const stamp = `${toIcsDate(po.updatedAt)}T000000Z`;
  const dayAfter = new Date(due.getTime() + 86_400_000);

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ZenoSource//Purchase order//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${po.id}@zenosource`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${toIcsDate(due)}`,
    `DTEND;VALUE=DATE:${toIcsDate(dayAfter)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    "BEGIN:VALARM",
    "TRIGGER:-P2D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(`${po.number} due in 2 days`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${po.number}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
