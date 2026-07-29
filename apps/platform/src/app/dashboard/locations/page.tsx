import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { locationScopeFor } from "@/lib/access";
import { plural } from "@/lib/format";
import { EmptyState, Ledger, LinkButton, PageHeader, StatusChip, Td, Th } from "@/components/ui";

export const metadata: Metadata = { title: "Locations" };

export default async function LocationsPage() {
  const user = await getCurrentInternalUser();

  // Tenant-scoped *and* location-scoped. It was only the former, so a MEMBER
  // restricted to one plant could read the name, code and address of every
  // other site in the company — a scope leak on the entity that defines the
  // scope.
  const scope = await locationScopeFor(user);
  const locations = await db.location.findMany({
    where: { tenantId: user.tenantId, ...(scope ? { id: { in: scope } } : {}) },
    include: { _count: { select: { assignedUsers: true, purchaseOrderLines: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <PageHeader
        title="Locations"
        meta="Every purchase order line ships to one of these, and each one is the unit of access: a member sees the orders for their locations and nothing else."
        actions={
          // Hidden for a MEMBER rather than rendered and refused on submit —
          // the old form filled a whole screen before saying no.
          user.role === "OWNER" ? (
            <LinkButton href="/dashboard/locations/new" variant="primary">
              Add a location
            </LinkButton>
          ) : undefined
        }
      />

      {locations.length === 0 ? (
        <EmptyState
          headline={scope ? "You aren't assigned to any location." : "No locations yet."}
          body={
            scope
              ? "That's why your board and your order list are empty. An owner assigns you to the sites you buy for."
              : "A location is a plant, warehouse or site you receive into. Purchase orders can't be raised until at least one exists."
          }
          action={
            user.role === "OWNER" ? (
              <LinkButton href="/dashboard/locations/new" variant="primary">
                Add a location
              </LinkButton>
            ) : undefined
          }
        />
      ) : (
        <Ledger caption="Locations">
          <thead>
            <tr>
              <Th>Location</Th>
              <Th width="7rem">Code</Th>
              <Th>Address</Th>
              <Th align="right" width="7rem">
                People
              </Th>
              <Th width="7rem" />
            </tr>
          </thead>
          <tbody>
            {locations.map((location) => (
              <tr key={location.id} className="hover:bg-rule/30">
                <Td>
                  <Link
                    href={`/dashboard/locations/${location.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {location.name}
                  </Link>
                </Td>
                <Td mono>{location.code}</Td>
                <Td>
                  <span className="text-ink-soft">
                    {[
                      location.addressLine1,
                      location.city,
                      location.region,
                      location.postalCode,
                      location.country,
                    ]
                      .filter(Boolean)
                      .join(", ") || "no address on file"}
                  </span>
                </Td>
                <Td align="right" mono>
                  {location._count.assignedUsers || <span className="text-ink-faint">—</span>}
                </Td>
                <Td>
                  {location.status === "INACTIVE" && (
                    <StatusChip variant="settled">Closed</StatusChip>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Ledger>
      )}

      {locations.some((l) => l._count.assignedUsers === 0) && user.role === "OWNER" && (
        <p className="mt-4 text-sm text-ink-soft">
          {locations.filter((l) => l._count.assignedUsers === 0).length}{" "}
          {plural(locations.filter((l) => l._count.assignedUsers === 0).length, "location has", "locations have")}{" "}
          nobody assigned — orders there are visible only to owners.
        </p>
      )}
    </div>
  );
}
