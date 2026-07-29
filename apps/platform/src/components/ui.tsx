import { type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  formatDate,
  formatDwell,
  formatMoney,
  formatQuantity,
  formatUnitPrice,
  ageStepSince,
  daysBetween,
} from "@/lib/format";
import type { Court } from "@/lib/lifecycle";

// Server-safe presentation primitives. Anything needing a hook lives in
// ./forms.tsx behind a "use client" boundary.
//
// The rule this file enforces: colour is only ever reachable through <Dwell>
// and <CourtMark>. There is no `tone="danger"` here and no accent colour to
// pass. If a screen wants to look urgent, it has to earn it with a real
// dwell — see src/app/globals.css.

// --- Page scaffolding ------------------------------------------------------

export function PageHeader({
  title,
  eyebrow,
  meta,
  actions,
  back,
}: {
  title: ReactNode;
  /** Small label above the title — document class, section, breadcrumb-ish. */
  eyebrow?: ReactNode;
  /** Facts about the record, rendered as a dotted run under the title. */
  meta?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link
          href={back.href}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink no-print"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-ink-faint">
              {eyebrow}
            </p>
          )}
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {meta && <div className="mt-1.5 text-sm text-ink-soft">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 no-print">{actions}</div>}
      </div>
    </div>
  );
}

/** A dotted run of facts: `4 lines · Fabrication · P-10418`. */
export function MetaList({ children }: { children: ReactNode[] }) {
  const items = children.filter(Boolean);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden className="text-rule-strong">·</span>}
          {item}
        </span>
      ))}
    </span>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {title && (
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                {title}
              </h2>
            )}
            {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 no-print">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border border-rule bg-paper-raised ${className}`}>{children}</div>
  );
}

/**
 * A designed empty state. Every list in the app had one of two failure modes
 * before this: a bare sentence in grey, or nothing at all. An empty screen
 * has to say what would fill it and how to make that happen.
 */
export function EmptyState({
  headline,
  body,
  action,
}: {
  headline: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="border border-dashed border-rule-strong px-6 py-12 text-center">
      <p className="text-base font-medium text-ink">{headline}</p>
      {body && <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Callout({
  children,
  title,
}: {
  children: ReactNode;
  title?: ReactNode;
}) {
  return (
    <div className="border-l-2 border-rule-strong bg-paper-raised px-4 py-3">
      {title && <p className="mb-1 text-sm font-semibold text-ink">{title}</p>}
      <div className="text-sm text-ink-soft">{children}</div>
    </div>
  );
}

// --- The ledger ------------------------------------------------------------
//
// Lists are ledgers: hairline rules, aligned columns, one row per record.
// The card-per-row layout this replaces spent 880px of horizontal space per
// row to show three facts, and made thirty POs indistinguishable from each
// other at a glance — which is the only thing a list is for.

export function Ledger({
  children,
  caption,
}: {
  children: ReactNode;
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto border border-rule bg-paper-raised">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  width,
  scope = "col",
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  scope?: "col" | "row";
}) {
  return (
    <th
      scope={scope}
      style={width ? { width } : undefined}
      className={`border-b border-rule-strong px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  mono = false,
  className = "",
  colSpan,
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  mono?: boolean;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`border-b border-rule px-3 py-2.5 align-top text-ink ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      } ${mono ? "font-mono tabular-nums" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

// --- The clock -------------------------------------------------------------

/**
 * The `WAITING` cell — the single most important pixel in the product.
 *
 * `since` null means nothing is open on this record, which renders blank
 * rather than `0d`. That is the first standing law in docs/todo.md: most of
 * a real tenant is at rest, and a zero drawn on settled work is as
 * misleading as a hot one.
 *
 * `owned` gates the full ramp. Items assigned to the reader get hue and
 * weight; everything else gets the muted variant. The ramp is bounded by
 * human capacity on purpose — a list where every row shouts is a list with
 * no signal in it.
 */
export function Dwell({
  since,
  owned = false,
  settled,
}: {
  since: Date | string | null | undefined;
  owned?: boolean;
  /** Shown in place of the clock once work is finished, e.g. `closed 14 Jun`. */
  settled?: string | null;
}) {
  if (!since) {
    return (
      <span className="at-rest font-mono text-xs">
        {settled ?? <span className="sr-only">Nothing open</span>}
      </span>
    );
  }
  const from = typeof since === "string" ? new Date(since) : since;
  const step = ageStepSince(from);
  const days = daysBetween(from);
  return (
    <span
      className={`age-${step}${owned ? "" : " muted"} font-mono tabular-nums`}
      title={`Open since ${formatDate(from)} — ${days} day${days === 1 ? "" : "s"}`}
    >
      {formatDwell(from)}
    </span>
  );
}

/**
 * Whose court. Cobalt for "them", plain ink for us — asymmetric on purpose:
 * a buyer scanning their own list needs the supplier-side rows to separate
 * out, and the buyer-side rows are already the default reading.
 */
export function CourtMark({ court, children }: { court: Court; children: ReactNode }) {
  if (court === "SUPPLIER") {
    return <span className="text-court-them">{children}</span>;
  }
  if (court === "NOBODY") {
    return <span className="text-ink-faint">{children}</span>;
  }
  return <span className="text-ink">{children}</span>;
}

/**
 * State, as a word. No hue — nine PO statuses previously shared four badge
 * tones, so `closed` (grey) sat beside `fulfilled` (green) and the colour
 * carried no information the word didn't already carry.
 *
 * `unowned` is the exception, and it isn't decoration: it hatches a
 * non-terminal state that minted no action item, which is the modeling bug
 * docs/product.md names. It should never appear in a correct build.
 */
export function StatusChip({
  children,
  variant = "live",
}: {
  children: ReactNode;
  variant?: "live" | "settled" | "unowned";
}) {
  const base =
    "inline-flex items-center border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide";
  if (variant === "settled") {
    return <span className={`${base} border-rule text-ink-faint`}>{children}</span>;
  }
  if (variant === "unowned") {
    return (
      <span className={`${base} unowned border-rule-strong`} title="No action item — this state is unowned">
        {children}
      </span>
    );
  }
  return <span className={`${base} border-rule-strong text-ink-soft`}>{children}</span>;
}

// --- Typed values ----------------------------------------------------------
//
// Every comparable number is mono and tabular. A column of prices in a
// proportional face is a column you have to read one row at a time.

export function DocNumber({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono font-medium tracking-tight ${className}`}>{children}</span>;
}

export function Money({
  value,
  precise = false,
  className = "",
}: {
  value: number | string | { toString(): string } | null | undefined;
  /** Unit prices carry four decimals; totals carry two. */
  precise?: boolean;
  className?: string;
}) {
  return (
    <span className={`font-mono tabular-nums ${className}`}>
      {precise ? formatUnitPrice(value) : formatMoney(value)}
    </span>
  );
}

export function Qty({
  value,
  uom,
}: {
  value: number | string | { toString(): string } | null | undefined;
  uom?: string;
}) {
  return (
    <span className="font-mono tabular-nums">
      {formatQuantity(value)}
      {uom ? <span className="ml-1 text-ink-faint">{uom}</span> : null}
    </span>
  );
}

export function DateText({ value }: { value: Date | string | null | undefined }) {
  return <span className="font-mono tabular-nums text-[0.9em]">{formatDate(value)}</span>;
}

// --- Links and buttons -----------------------------------------------------
//
// No accent colour. The primary action is the one with ink behind it; there
// is exactly one per screen.

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none min-h-11";

export const BUTTON_VARIANTS = {
  primary: "border-ink bg-ink text-paper hover:bg-ink-soft hover:border-ink-soft",
  secondary: "border-rule-strong bg-paper-raised text-ink hover:bg-rule/40",
  quiet: "border-transparent text-ink-soft hover:text-ink hover:bg-rule/40",
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function LinkButton({
  href,
  children,
  variant = "secondary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  return (
    <Link href={href} className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function ErrorText({ children, id }: { children?: ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p
      id={id}
      role="alert"
      className="mb-4 border-l-2 border-age-4 bg-paper-raised px-3 py-2 text-sm text-ink"
    >
      {children}
    </p>
  );
}

/** Screen-reader-only text. Used often enough to deserve a name. */
export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
