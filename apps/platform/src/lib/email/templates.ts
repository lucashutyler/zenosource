import { formatDate, formatMoney, formatQuantity } from "@/lib/format";
import { claimCodeFor } from "@/lib/action-items";
import { ACTION_COPY } from "@/lib/lifecycle";
import type { ActionItemType } from "@/generated/prisma/enums";

// The supplier email, as a designed artifact.
//
// This is the most widely distributed screen ZenoSource owns and the only one
// most suppliers will ever see. Hundreds of companies who will never pay us
// form their entire impression of the product here, and every one of them is
// deciding whether to bother responding. What it replaces:
//
//     Subject: 2 open items with Acme Manufacturing
//     - Acknowledge purchase order: https://…/a/9f3c…64-hex…
//     - Acknowledge purchase order: https://…/a/1b7e…64-hex…
//
// Two byte-identical lines with no document number, no part, no quantity, no
// date, and a URL that looks like malware. A supplier could not tell which
// order either line referred to without clicking both.
//
// The competitive note that shapes this: SourceDay already markets
// `"No login", interactive emails`. The differentiator isn't that ours
// exists — it's that ours is conspicuously better.

export type ActionEmailItem = {
  actionType: ActionItemType;
  accessToken: string;
  documentNumber: string | null;
  /** `500 EA SKU-1001 — Bearing housing` */
  lineSummary: string | null;
  needByDate: Date | null;
  value: number | null;
  lineCount: number;
};

export type ActionEmailParams = {
  tenantName: string;
  contactName: string;
  /** The named buyer a reply reaches. */
  buyerName: string | null;
  buyerEmail: string | null;
  items: ActionEmailItem[];
  baseUrl: string;
};

/**
 * The subject line carries the commitment, not a count.
 *
 * `2 open items with Acme Manufacturing` tells a supplier nothing they can
 * act on and nothing they can search their inbox for three weeks later. A
 * subject naming the document, the part and the quantity is a subject that
 * still works as a search term.
 */
export function actionEmailSubject(params: ActionEmailParams): string {
  const [first, ...rest] = params.items;
  if (!first) return `${params.tenantName} — nothing outstanding`;

  const verb = ACTION_COPY[first.actionType]?.external ?? "Respond";
  const doc = first.documentNumber ? ` on ${first.documentNumber}` : "";
  const detail = first.lineSummary ? ` — ${first.lineSummary}` : "";
  const more = rest.length > 0 ? ` (+${rest.length} more)` : "";

  if (first.actionType === "PO_ACKNOWLEDGE") {
    return `${params.tenantName} needs a date${doc}${detail}${more}`;
  }
  if (first.actionType === "RFQ_SUBMIT_QUOTE") {
    return `${params.tenantName} wants a price${doc}${detail}${more}`;
  }
  return `${params.tenantName}: ${verb.toLowerCase()}${doc}${detail}${more}`;
}

/** The line clients show under the subject — never left to chance. */
export function actionEmailPreview(params: ActionEmailParams): string {
  return params.items.length === 1
    ? "Tap once to confirm. No account, no password."
    : `${params.items.length} things to confirm. No account, no password.`;
}

function itemHeadline(item: ActionEmailItem, tenantName: string): string {
  switch (item.actionType) {
    case "PO_ACKNOWLEDGE":
      return `Confirm you can meet this order`;
    case "PO_DELIVER":
      return `${tenantName} is waiting on this delivery`;
    case "RFQ_SUBMIT_QUOTE":
      return `Send your price and lead time`;
    default:
      return ACTION_COPY[item.actionType]?.external || "Respond";
  }
}

/**
 * The button label carries the actual commitment — `Confirm — 500 EA by
 * 14 Aug`, not `Respond`. A supplier should be able to act correctly without
 * opening anything, and should know exactly what they agreed to afterwards.
 */
function itemCta(item: ActionEmailItem): string {
  if (item.actionType === "PO_ACKNOWLEDGE") {
    const qty = item.lineSummary?.split(" — ")[0];
    const by = item.needByDate ? ` by ${formatDate(item.needByDate)}` : "";
    return qty && item.lineCount === 1 ? `Confirm — ${qty}${by}` : `Confirm this order${by}`;
  }
  if (item.actionType === "RFQ_SUBMIT_QUOTE") {
    return item.needByDate ? `Quote — due ${formatDate(item.needByDate)}` : "Send your quote";
  }
  return "Open and respond";
}

export function actionEmailText(params: ActionEmailParams): string {
  const lines: string[] = [];
  lines.push(`${params.tenantName} needs a response from you.`);
  lines.push("");
  lines.push("No account and no password — each link below opens straight to the response form.");
  lines.push("");

  for (const item of params.items) {
    lines.push(`${item.documentNumber ?? "—"}  ${itemHeadline(item, params.tenantName)}`);
    if (item.lineSummary) lines.push(`  ${item.lineSummary}`);
    if (item.needByDate) lines.push(`  Needed by ${formatDate(item.needByDate)}`);
    if (item.value != null) lines.push(`  ${formatMoney(item.value)}`);
    lines.push(`  ${params.baseUrl}/a/${item.accessToken}`);
    lines.push(`  Reference: ${claimCodeFor(item.accessToken)}`);
    lines.push("");
  }

  if (params.buyerName) {
    lines.push(`Reply to this email to reach ${params.buyerName} at ${params.tenantName}.`);
  }
  lines.push("");
  lines.push(`Sent by ${params.tenantName} through ZenoSource.`);
  return lines.join("\n");
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * Inline styles and table layout throughout — not a stylistic choice. Outlook
 * on Windows renders through Word's HTML engine, which ignores `<style>`
 * blocks, flexbox and grid entirely. Manufacturing suppliers are the single
 * most Outlook-heavy audience there is.
 */
export function actionEmailHtml(params: ActionEmailParams): string {
  const preview = actionEmailPreview(params);

  const cards = params.items
    .map((item) => {
      const href = `${params.baseUrl}/a/${item.accessToken}`;
      const claim = claimCodeFor(item.accessToken);
      return `
      <tr><td style="padding:0 0 12px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e0d9;background:#ffffff;">
          <tr><td style="padding:18px 20px 16px 20px;">
            ${
              item.documentNumber
                ? `<div style="font:600 13px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em;color:#1a1817;">${esc(item.documentNumber)}</div>`
                : ""
            }
            <div style="margin:6px 0 0 0;font:600 17px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1817;">
              ${esc(itemHeadline(item, params.tenantName))}
            </div>
            ${
              item.lineSummary
                ? `<div style="margin:8px 0 0 0;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#55504b;">${esc(item.lineSummary)}</div>`
                : ""
            }
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0 0 0;">
              ${
                item.needByDate
                  ? `<tr>
                      <td style="padding:2px 16px 2px 0;font:400 12px/1.5 -apple-system,Arial,sans-serif;color:#7d766e;text-transform:uppercase;letter-spacing:.06em;">Needed by</td>
                      <td style="padding:2px 0;font:600 13px/1.5 ui-monospace,Menlo,monospace;color:#1a1817;">${esc(formatDate(item.needByDate))}</td>
                    </tr>`
                  : ""
              }
              ${
                item.value != null
                  ? `<tr>
                      <td style="padding:2px 16px 2px 0;font:400 12px/1.5 -apple-system,Arial,sans-serif;color:#7d766e;text-transform:uppercase;letter-spacing:.06em;">Order value</td>
                      <td style="padding:2px 0;font:600 13px/1.5 ui-monospace,Menlo,monospace;color:#1a1817;">${esc(formatMoney(item.value))}</td>
                    </tr>`
                  : ""
              }
            </table>

            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 0 0;">
              <tr><td style="background:#1a1817;">
                <a href="${esc(href)}" style="display:block;padding:14px 22px;font:600 15px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#fbfaf8;text-decoration:none;">
                  ${esc(itemCta(item))}
                </a>
              </td></tr>
            </table>
            <div style="margin:10px 0 0 0;font:400 12px/1.5 -apple-system,Arial,sans-serif;color:#7d766e;">
              Reference <span style="font:600 12px ui-monospace,Menlo,monospace;color:#55504b;">${esc(claim)}</span> — no account or password needed.
            </div>
          </td></tr>
        </table>
      </td></tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(actionEmailSubject(params))}</title></head>
<body style="margin:0;padding:0;background:#fbfaf8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbfaf8;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

      <tr><td style="padding:0 0 18px 0;border-bottom:2px solid #1a1817;">
        <div style="font:600 18px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1817;">${esc(params.tenantName)}</div>
        <div style="margin:3px 0 0 0;font:400 13px/1.4 -apple-system,Arial,sans-serif;color:#7d766e;">
          for ${esc(params.contactName)}
        </div>
      </td></tr>

      <tr><td style="padding:20px 0 16px 0;font:400 15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1817;">
        ${
          params.items.length === 1
            ? `There's one thing outstanding on your account with ${esc(params.tenantName)}.`
            : `There are ${params.items.length} things outstanding on your account with ${esc(params.tenantName)}.`
        }
      </td></tr>

      ${cards}

      <tr><td style="padding:12px 0 0 0;border-top:1px solid #e4e0d9;font:400 13px/1.6 -apple-system,Arial,sans-serif;color:#55504b;">
        ${
          params.buyerName
            ? `Reply to this email and it reaches <strong style="color:#1a1817;">${esc(params.buyerName)}</strong> at ${esc(params.tenantName)}.`
            : `Reply to this email to reach ${esc(params.tenantName)}.`
        }
      </td></tr>
      <tr><td style="padding:14px 0 0 0;font:400 11px/1.5 -apple-system,Arial,sans-serif;color:#7d766e;">
        Sent by ${esc(params.tenantName)} through ZenoSource.
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

/** `500 EA SKU-1001 — Bearing housing`, or `4 lines` for a multi-line order. */
export function summarizeLines(
  lines: { itemNumber: string; description: string; quantity: unknown; uom: string }[]
): string | null {
  if (lines.length === 0) return null;
  if (lines.length === 1) {
    const l = lines[0];
    return `${formatQuantity(l.quantity as number)} ${l.uom} ${l.itemNumber} — ${l.description}`;
  }
  const first = lines[0];
  return `${lines.length} lines, incl. ${formatQuantity(first.quantity as number)} ${first.uom} ${first.itemNumber}`;
}
