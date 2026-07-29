import { notFound } from "next/navigation";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";
import { AssignUserForm } from "./assign-user-form";

export default async function LocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentInternalUser();
  if (!user) notFound();

  const location = await db.location.findFirst({
    where: { id, tenantId: user.tenantId },
    include: { assignedUsers: { include: { internalUser: true } } },
  });
  if (!location) notFound();

  const allUsers = await db.internalUser.findMany({ where: { tenantId: user.tenantId } });
  const assignedIds = new Set(location.assignedUsers.map((a) => a.internalUserId));
  const candidates = allUsers.filter((u) => !assignedIds.has(u.id));

  return (
    <div>
      <PageHeader
        title={location.name}
        subtitle={`${location.code} · ${[location.city, location.region, location.country].filter(Boolean).join(", ") || "no address on file"}`}
        action={<Badge tone={location.status === "ACTIVE" ? "success" : "neutral"}>{location.status.toLowerCase()}</Badge>}
      />

      <Card>
        <div className="p-4">
          <h2 className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
            Assigned users
          </h2>
          <p className="text-xs text-zinc-500">
            Members see and manage only POs whose lines ship here (or to another location
            they&apos;re assigned to). Owners see every location automatically.
          </p>
        </div>
        {location.assignedUsers.length > 0 && (
          <ul className="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {location.assignedUsers.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-zinc-950 dark:text-zinc-50">
                  {a.internalUser.name}
                </span>
                <span className="text-xs text-zinc-500">{a.internalUser.role.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        )}
        {user.role === "OWNER" && (
          <AssignUserForm locationId={location.id} candidates={candidates} />
        )}
      </Card>
    </div>
  );
}
