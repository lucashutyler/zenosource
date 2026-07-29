import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { locationScopeFor } from "@/lib/access";
import { setLocationStatus, unassignUserFromLocation } from "@/app/actions/locations";
import { plural } from "@/lib/format";
import {
  MetaList,
  PageHeader,
  Panel,
  Section,
  StatusChip,
} from "@/components/ui";
import { SimpleAction } from "@/components/simple-action";
import { LocationForm } from "../location-form";
import { AssignUserForm } from "./assign-user-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const location = await db.location.findUnique({ where: { id }, select: { name: true } });
  return { title: location?.name ?? "Location" };
}

export default async function LocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentInternalUser();

  const scope = await locationScopeFor(user);
  if (scope && !scope.includes(id)) notFound();

  const location = await db.location.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      assignedUsers: { include: { internalUser: true } },
      _count: { select: { purchaseOrderLines: true } },
    },
  });
  if (!location) notFound();

  const isOwner = user.role === "OWNER";
  const allUsers = isOwner
    ? await db.internalUser.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: "asc" } })
    : [];
  const assignedIds = new Set(location.assignedUsers.map((a) => a.internalUserId));
  const candidates = allUsers.filter((u) => !assignedIds.has(u.id));

  return (
    <div>
      <PageHeader
        back={{ href: "/dashboard/locations", label: "All locations" }}
        eyebrow="Location"
        title={location.name}
        meta={
          <MetaList>
            {[
              <span key="c" className="font-mono">
                {location.code}
              </span>,
              location.status === "INACTIVE" ? (
                <StatusChip key="s" variant="settled">
                  Closed
                </StatusChip>
              ) : null,
              <span key="a">
                {location.assignedUsers.length}{" "}
                {plural(location.assignedUsers.length, "person", "people")}
              </span>,
              <span key="l">
                {location._count.purchaseOrderLines} order{" "}
                {plural(location._count.purchaseOrderLines, "line")}
              </span>,
            ].filter(Boolean) as React.ReactNode[]}
          </MetaList>
        }
        actions={
          isOwner ? (
            <SimpleAction
              action={setLocationStatus.bind(null, location.id, location.status === "INACTIVE")}
              label={location.status === "ACTIVE" ? "Close this site" : "Reopen"}
              variant="quiet"
              confirm={
                location.status === "ACTIVE"
                  ? {
                      title: `Close ${location.name}?`,
                      body: "It stops appearing when raising new orders. Everything already shipping here keeps running, and the people assigned keep their access to it.",
                      confirmLabel: "Close it",
                    }
                  : undefined
              }
            />
          ) : undefined
        }
      />

      {isOwner && (
        <Section title="Details">
          <LocationForm
            mode="edit"
            locationId={location.id}
            initial={{
              name: location.name,
              code: location.code,
              addressLine1: location.addressLine1,
              addressLine2: location.addressLine2,
              city: location.city,
              region: location.region,
              postalCode: location.postalCode,
              country: location.country,
            }}
          />
        </Section>
      )}

      <Section
        title="Who can see this site"
        description="Members see and manage only the orders whose lines ship to a location they're assigned to. Owners see everything."
      >
        <Panel className="divide-y divide-rule">
          {location.assignedUsers.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-faint">
              Nobody is assigned. Orders shipping here are visible only to owners.
            </p>
          ) : (
            location.assignedUsers.map((assignment) => (
              <div
                key={assignment.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
              >
                <span>
                  <span className="text-ink">{assignment.internalUser.name}</span>
                  <span className="ml-3 text-ink-soft">{assignment.internalUser.email}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs uppercase tracking-wide text-ink-faint">
                    {assignment.internalUser.role.toLowerCase()}
                  </span>
                  {isOwner && (
                    // Assignment used to be one-way. Somebody who moves teams
                    // kept seeing every order at their old plant forever —
                    // an access-control gap, not a missing convenience.
                    <SimpleAction
                      action={unassignUserFromLocation.bind(
                        null,
                        location.id,
                        assignment.internalUserId
                      )}
                      label="Remove"
                      variant="quiet"
                      confirm={{
                        title: `Remove ${assignment.internalUser.name} from ${location.name}?`,
                        body: "They immediately stop seeing orders that ship here. Anything already assigned to them stays assigned — check their board doesn't go silent.",
                        confirmLabel: "Remove access",
                      }}
                    />
                  )}
                </span>
              </div>
            ))
          )}
          {isOwner && <AssignUserForm locationId={location.id} candidates={candidates} />}
        </Panel>
      </Section>
    </div>
  );
}
