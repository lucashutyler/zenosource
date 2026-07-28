import { getCurrentInternalUser } from "@/lib/dal";
import { countOpenActionItemsForInternalUser } from "@/lib/action-items";
import { DashboardShell } from "./shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentInternalUser();
  const openCount = await countOpenActionItemsForInternalUser(user.id);

  return (
    <DashboardShell userName={user.name} openCount={openCount}>
      {children}
    </DashboardShell>
  );
}
