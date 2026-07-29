"use client";

import { useActionState } from "react";
import { createLocation, updateLocation } from "@/app/actions/locations";
import { FormErrors, SubmitButton, TextField } from "@/components/forms";
import { PageHeader, Panel } from "@/components/ui";
import { valueFor } from "@/lib/form-state";

type LocationValues = {
  name: string;
  code: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
};

export function LocationForm({
  mode,
  locationId,
  initial,
}: {
  mode: "create" | "edit";
  locationId?: string;
  initial?: LocationValues;
}) {
  const action = mode === "create" ? createLocation : updateLocation.bind(null, locationId!);
  const [state, formAction] = useActionState(action, undefined);
  const errors = state?.fieldErrors ?? {};

  const body = (
    <form action={formAction}>
      <FormErrors state={state} />

      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField
          label="Name"
          name="name"
          required
          placeholder="Chicago Plant"
          defaultValue={valueFor(state, "name", initial?.name)}
          error={errors.name}
        />
        <TextField
          label="Code"
          name="code"
          required
          placeholder="CHI-01"
          hint="Short and unique. It's what appears on a purchase order line."
          defaultValue={valueFor(state, "code", initial?.code)}
          error={errors.code}
        />
      </div>

      {/* The street address and postal code were columns on the model from
          day one and the form asked for neither, so the address printed on a
          purchase order was a city and a country — not deliverable. */}
      <TextField
        label="Street address"
        name="addressLine1"
        optional
        defaultValue={valueFor(state, "addressLine1", initial?.addressLine1)}
        error={errors.addressLine1}
      />
      <TextField
        label="Address line 2"
        name="addressLine2"
        optional
        defaultValue={valueFor(state, "addressLine2", initial?.addressLine2)}
        error={errors.addressLine2}
      />

      <div className="grid gap-x-4 sm:grid-cols-4">
        <TextField
          label="City"
          name="city"
          optional
          defaultValue={valueFor(state, "city", initial?.city)}
          error={errors.city}
        />
        <TextField
          label="Region / State"
          name="region"
          optional
          defaultValue={valueFor(state, "region", initial?.region)}
          error={errors.region}
        />
        <TextField
          label="Postal code"
          name="postalCode"
          optional
          defaultValue={valueFor(state, "postalCode", initial?.postalCode)}
          error={errors.postalCode}
        />
        <TextField
          label="Country"
          name="country"
          optional
          defaultValue={valueFor(state, "country", initial?.country)}
          error={errors.country}
        />
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton variant={mode === "create" ? "primary" : "secondary"} pendingLabel="Saving…">
          {mode === "create" ? "Save location" : "Save"}
        </SubmitButton>
        {state?.ok && (
          <span role="status" className="text-sm text-settled">
            {state.ok}
          </span>
        )}
      </div>
    </form>
  );

  if (mode === "edit") return <Panel className="p-4">{body}</Panel>;

  return (
    <div className="max-w-2xl">
      <PageHeader
        back={{ href: "/dashboard/locations", label: "All locations" }}
        eyebrow="New"
        title="Add a location"
        meta="A plant, warehouse or site you receive into. Members are assigned to locations, and see only the orders that ship to them."
      />
      {body}
    </div>
  );
}
