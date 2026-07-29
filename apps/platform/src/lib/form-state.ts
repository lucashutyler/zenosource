// The shape every server action in this app returns, and the machinery for
// not throwing the user's work away.
//
// The audit's finding, verbatim: one missing Location on line 3 of a new PO
// destroyed roughly 35 filled-in fields — supplier, five lines, every date —
// and returned `Line 3: Invalid input` as the only explanation. The user had
// no way to know which field, and nothing left to correct.
//
// Two fixes, both of which live here so no form can forget them:
//   * `values` echoes the submitted FormData back, and every control reads
//     its default from it. A failed submit now costs a keystroke, not a
//     re-entry.
//   * `fieldErrors` is keyed by the control's own `name`, so the message
//     lands under the field it's about and gets read out by a screen reader
//     through `aria-describedby`.

export type FormState =
  | {
      /** Form-level failure — auth, a lost record, a concurrent edit. */
      error?: string;
      /** Keyed by control name: `supplierId`, `quantity-2`, `needByDate-0`. */
      fieldErrors?: Record<string, string>;
      /** Everything the user typed, echoed back so nothing is lost. */
      values?: Record<string, string>;
      /** Set on the happy path when the action stays on the page. */
      ok?: string;
    }
  | undefined;

/**
 * Flatten a submitted FormData into echoable strings.
 *
 * Files and the framework's own `$ACTION_*` bookkeeping fields are dropped —
 * the first can't round-trip through a `defaultValue`, and the second would
 * leak React internals into the DOM.
 */
export function echoValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (key.startsWith("$ACTION")) continue;
    values[key] = value;
  }
  return values;
}

/** Build a failure state that keeps the user's input. */
export function fail(
  formData: FormData,
  fieldErrors: Record<string, string>,
  error?: string
): FormState {
  const count = Object.keys(fieldErrors).length;
  return {
    error:
      error ??
      (count > 0
        ? `${count} field${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention.`
        : "That didn't work."),
    fieldErrors,
    values: echoValues(formData),
  };
}

/** Build a form-level failure that keeps the user's input. */
export function failWith(formData: FormData, error: string): FormState {
  return { error, values: echoValues(formData) };
}

/**
 * What a control should show: the echoed value if the form is coming back
 * from a failure, otherwise whatever the record already held.
 */
export function valueFor(
  state: FormState,
  name: string,
  fallback: string | number | null | undefined
): string {
  const echoed = state?.values?.[name];
  if (echoed !== undefined) return echoed;
  return fallback == null ? "" : String(fallback);
}
