import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { Card, PageHeader, LinkButton } from "@/components/ui";

export default async function LocationsPage() {
  const user = await getCurrentInternalUser();
  const locations = user
    ? await db.location.findMany({
        where: { tenantId: user.tenantId },
        orderBy: { name: "asc" },
      })
    : [];

  return (
    <div>
      <PageHeader
        title="Locations"
        subtitle="Every PO line ships to one of these. Users are assigned to the locations they manage."
        action={
          user?.role === "OWNER" ? (
            <LinkButton href="/dashboard/locations/new">Add location</LinkButton>
          ) : undefined
        }
      />

      {locations.length === 0 ? (
        <p className="text-sm text-zinc-500">No locations yet.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {locations.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/dashboard/locations/${l.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                      {l.name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {l.code} · {[l.city, l.region, l.country].filter(Boolean).join(", ") || "no address"}
                    </p>
                  </div>
                  <span className="text-xs text-zinc-400">{l.status.toLowerCase()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
