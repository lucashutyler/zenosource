import { getCurrentInternalUser } from "@/lib/dal";
import { countOpenActionItemsForInternalUser } from "@/lib/action-items";
import { isMailboxActive } from "@/lib/email/sender";
import { locationScopeFor } from "@/lib/access";
import { isFeatureEnabled } from "@/lib/integrations/connections";
import { db } from "@/lib/db";
import { DashboardShell } from "./shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentInternalUser();
  const [openCount, tenant, scope, showPOSuggestions] = await Promise.all([
    countOpenActionItemsForInternalUser(user.id),
    db.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true } }),
    locationScopeFor(user),
    // The nav can't read this itself — it's a Client Component, and the
    // answer depends on a connection row plus what that connection's last
    // health check actually verified.
    isFeatureEnabled(user.tenantId, "po-suggestions"),
  ]);

  // Resolve the scope to names for the sidebar. An OWNER's scope is
  // undefined (unrestricted) and renders as "All locations".
  const scopeNames = scope
    ? (
        await db.location.findMany({
          where: { id: { in: scope } },
          select: { name: true },
          orderBy: { name: "asc" },
        })
      ).map((l) => l.name)
    : null;

  return (
    <DashboardShell
      userName={user.name}
      userEmail={user.email}
      role={user.role}
      organization={tenant?.name}
      locationScope={scopeNames}
      openCount={openCount}
      showMailbox={isMailboxActive()}
      showPOSuggestions={showPOSuggestions}
    >
      {children}
    </DashboardShell>
  );
}
