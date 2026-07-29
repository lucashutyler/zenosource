"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { useFormStatus } from "react-dom";
import { BUTTON_VARIANTS, type ButtonVariant } from "@/components/ui";
import type { FormState } from "@/lib/form-state";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none min-h-11";

// --- Submitting ------------------------------------------------------------

/**
 * The only submit button in the app.
 *
 * Pending state comes from `useFormStatus()` rather than a prop, which is
 * the whole point: the audit found seven buttons with no `pending` prop, and
 * they were *precisely* the seven irreversible ones — Award, Close RFQ,
 * Accept and Reject a proposal, three Duplicates, Run reminder job. A prop
 * you can forget will be forgotten on the actions where forgetting costs
 * most, because those are the ones written last. Reading it from context
 * removes the opportunity.
 */
export function SubmitButton({
  children,
  variant = "primary",
  pendingLabel,
  className = "",
  disabled,
  name,
  value,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  /** Shown while in flight. Defaults to the label with an ellipsis. */
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {pending ? (pendingLabel ?? <>{children}…</>) : children}
    </button>
  );
}

/**
 * An irreversible action, behind a modal that names its consequence.
 *
 * Award, Close RFQ, Cancel PO and Accept/Reject-proposal were plain buttons
 * that fired on a single click with no confirmation and no pending state.
 * The rule this encodes: colour lives in the confirm, never on the trigger.
 * A red `Cancel PO` sitting permanently on a PO page is a shouting button
 * that is wrong 99% of the time it's looked at, and it trains people to
 * ignore red.
 *
 * A native `<dialog>` so focus trapping, Escape, inertness of the page
 * behind, and the accessible-modal semantics are the browser's job and not
 * ours to get subtly wrong.
 */
export function ConfirmSubmit({
  trigger,
  title,
  body,
  confirmLabel,
  variant = "quiet",
  confirmVariant = "primary",
  children,
}: {
  trigger: ReactNode;
  title: string;
  /** What will happen. Say the consequence, including what *doesn't* happen. */
  body: ReactNode;
  confirmLabel: string;
  variant?: ButtonVariant;
  confirmVariant?: ButtonVariant;
  /** Extra controls collected as part of confirming — a reason, a date. */
  children?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]}`}
      >
        {trigger}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={headingId}
        className="m-auto w-[min(30rem,calc(100vw-2rem))] border border-rule-strong bg-paper-raised p-0 text-ink backdrop:bg-ink/40"
      >
        <div className="p-5">
          <h2 id={headingId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          <div className="mt-2 text-sm text-ink-soft">{body}</div>
          {children && <div className="mt-4">{children}</div>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className={`${BUTTON_BASE} ${BUTTON_VARIANTS.secondary}`}
            >
              Keep as is
            </button>
            <SubmitButton variant={confirmVariant}>{confirmLabel}</SubmitButton>
          </div>
        </div>
      </dialog>
    </>
  );
}

// --- Error handling --------------------------------------------------------

/**
 * Announces a failed submit and moves focus to the first bad field.
 *
 * Without this a screen-reader user submits, hears nothing, and is left at
 * the bottom of a form with no indication anything happened — the error text
 * renders somewhere above them in silence.
 */
export function FormErrors({ state }: { state: FormState }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef<FormState>(undefined);

  useEffect(() => {
    if (!state?.error || state === seen.current) return;
    seen.current = state;

    const firstField = Object.keys(state.fieldErrors ?? {})[0];
    const target = firstField
      ? (document.getElementById(firstField) as HTMLElement | null)
      : null;
    if (target) {
      target.focus({ preventScroll: false });
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
      ref.current?.focus();
    }
  }, [state]);

  if (!state?.error) return null;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="mb-5 border-l-2 border-age-4 bg-paper-raised px-3 py-2.5 text-sm text-ink"
    >
      {state.error}
    </div>
  );
}

// --- Fields ----------------------------------------------------------------
//
// Every control gets an `id` matching its `name`, so the `<label for>` that
// was already being rendered actually points at something. The audit counted
// 40 controls on the new-PO form: 0 labelled, 36 orphan labels. The fix is
// one line — `id={name}` — but it has to be somewhere every control passes
// through, which is here.

function fieldIds(name: string, error?: string, hint?: string) {
  const described = [error ? `${name}-error` : null, hint ? `${name}-hint` : null].filter(
    Boolean
  ) as string[];
  return {
    id: name,
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": described.length ? described.join(" ") : undefined,
  };
}

const CONTROL_BASE =
  "w-full border bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint min-h-11";

function controlClass(error?: string) {
  return `${CONTROL_BASE} ${error ? "border-age-4" : "border-rule-strong"}`;
}

function Label({
  htmlFor,
  children,
  required,
  optional,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink">
      {children}
      {required && (
        <span className="ml-1 text-age-3" aria-hidden>
          *
        </span>
      )}
      {required && <span className="sr-only"> (required)</span>}
      {optional && <span className="ml-1 font-normal text-ink-faint">(optional)</span>}
    </label>
  );
}

function FieldMessages({
  name,
  error,
  hint,
}: {
  name: string;
  error?: string;
  hint?: ReactNode;
}) {
  return (
    <>
      {hint && (
        <p id={`${name}-hint`} className="mt-1 text-xs text-ink-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${name}-error`} role="alert" className="mt-1 text-xs font-medium text-age-4">
          {error}
        </p>
      )}
    </>
  );
}

type BaseFieldProps = {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  /** Mark explicitly optional. Required fields are marked `*`; the rest are
      left plain unless a form mixes both, where silence is ambiguous. */
  optional?: boolean;
};

export function TextField({
  label,
  name,
  error,
  hint,
  required,
  optional,
  className = "",
  ...props
}: BaseFieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`mb-4 ${className}`}>
      <Label htmlFor={name} required={required} optional={optional}>
        {label}
      </Label>
      <input
        {...props}
        {...fieldIds(name, error, hint ? String(hint) : undefined)}
        name={name}
        required={required}
        className={controlClass(error)}
      />
      <FieldMessages name={name} error={error} hint={hint} />
    </div>
  );
}

export function SelectField({
  label,
  name,
  error,
  hint,
  required,
  optional,
  children,
  className = "",
  ...props
}: BaseFieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`mb-4 ${className}`}>
      <Label htmlFor={name} required={required} optional={optional}>
        {label}
      </Label>
      <select
        {...props}
        {...fieldIds(name, error, hint ? String(hint) : undefined)}
        name={name}
        required={required}
        className={controlClass(error)}
      >
        {children}
      </select>
      <FieldMessages name={name} error={error} hint={hint} />
    </div>
  );
}

export function TextAreaField({
  label,
  name,
  error,
  hint,
  required,
  optional,
  className = "",
  ...props
}: BaseFieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className={`mb-4 ${className}`}>
      <Label htmlFor={name} required={required} optional={optional}>
        {label}
      </Label>
      <textarea
        {...props}
        {...fieldIds(name, error, hint ? String(hint) : undefined)}
        name={name}
        required={required}
        className={`${controlClass(error)} min-h-24`}
      />
      <FieldMessages name={name} error={error} hint={hint} />
    </div>
  );
}

/**
 * A bare labelled control for grid layouts (the PO line editor), where the
 * label belongs in a column header rather than above each cell. Still emits
 * a real label — visually hidden, not absent.
 */
export function GridCell({
  label,
  name,
  error,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="sr-only">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${name}-error`} role="alert" className="mt-1 text-xs font-medium text-age-4">
          {error}
        </p>
      )}
    </div>
  );
}

export function GridInput({
  name,
  error,
  className = "",
  ...props
}: { name: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      {...fieldIds(name, error)}
      name={name}
      className={`${controlClass(error)} ${className}`}
    />
  );
}

export function GridSelect({
  name,
  error,
  children,
  className = "",
  ...props
}: { name: string; error?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      {...fieldIds(name, error)}
      name={name}
      className={`${controlClass(error)} ${className}`}
    >
      {children}
    </select>
  );
}

// --- Filters ---------------------------------------------------------------

/**
 * A filter control that applies on change.
 *
 * The `Apply` button it replaces made every filter a two-step interaction
 * and — worse — left the screen showing results that didn't match the
 * controls above them until you remembered to press it.
 */
export function AutoSubmit({ children }: { children: ReactNode }) {
  const formRef = useRef<HTMLFormElement | null>(null);
  return (
    <div
      ref={(node) => {
        formRef.current = node?.closest("form") ?? null;
      }}
      onChange={() => formRef.current?.requestSubmit()}
      className="contents"
    >
      {children}
      <noscript>
        <button type="submit" className={`${BUTTON_BASE} ${BUTTON_VARIANTS.secondary}`}>
          Apply
        </button>
      </noscript>
    </div>
  );
}

/**
 * A search box that submits on Enter and clears cleanly. Debounced
 * auto-submit was considered and rejected: a list that reflows while you're
 * still typing a part number is harder to use, not easier.
 */
export function SearchInput({
  name = "q",
  defaultValue = "",
  placeholder,
  label,
}: {
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  label: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="relative">
      <label htmlFor={name} className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-faint">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className={`${CONTROL_BASE} border-rule-strong`}
      />
    </div>
  );
}
