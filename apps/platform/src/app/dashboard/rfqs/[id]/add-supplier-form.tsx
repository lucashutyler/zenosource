"use client";

import { useActionState, useEffect, useState } from "react";
import { addRFQSupplier } from "@/app/actions/rfqs";
import { SubmitButton } from "@/components/forms";

/**
 * Adding a supplier after the fact. Without it, forgetting to tick a box at
 * creation time meant duplicating the whole request — and duplication used to
 * drop the invitees, producing a draft that could never be sent.
 */
export function AddSupplierForm({
  rfqId,
  invitedIds,
}: {
  rfqId: string;
  invitedIds: string[];
}) {
  const [state, action] = useActionState(addRFQSupplier.bind(null, rfqId), undefined);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);

  // Loaded on demand rather than shipped with every render of the page — a
  // tenant can have hundreds of suppliers and this control is rarely used.
  useEffect(() => {
    if (!open || suppliers.length > 0) return;
    fetch("/api/suppliers")
      .then((r) => r.json())
      .then((data: { id: string; name: string }[]) => setSuppliers(data))
      .catch(() => setSuppliers([]));
  }, [open, suppliers.length]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center border border-rule-strong px-3 py-2 text-sm font-medium text-ink hover:bg-rule/40"
      >
        Ask another supplier
      </button>
    );
  }

  const available = suppliers.filter((s) => !invitedIds.includes(s.id));

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="supplierId" className="sr-only">
          Supplier to invite
        </label>
        <select
          id="supplierId"
          name="supplierId"
          className="min-h-11 border border-rule-strong bg-paper-raised px-3 py-2 text-sm text-ink"
        >
          <option value="">Choose a supplier…</option>
          {available.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <SubmitButton variant="secondary" pendingLabel="Inviting…">
        Invite
      </SubmitButton>
      {state?.error && (
        <p role="alert" className="basis-full text-xs font-medium text-age-4">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="basis-full text-xs text-settled">
          {state.ok}
        </p>
      )}
    </form>
  );
}
