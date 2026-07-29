import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getCurrentInternalUser } from "@/lib/dal";
import { listOpenActionItemsForInternalUser, resolveActionItemContext } from "@/lib/action-items";
import { ACTION_LABELS } from "@/lib/action-labels";

export default async function DashboardPage() {
  const user = await getCurrentInternalUser();
  const items = await listOpenActionItemsForInternalUser(user.id);
  const context = await resolveActionItemContext(items);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
        Open action items
      </h1>
      <p className="mb-6 text-sm text-zinc-500">
        Assigned to you. If a teammate with access handles one first, it drops off this list
        automatically — nothing here can be actioned twice.
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing open right now.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {items.map((item) => {
            const ctx = context.get(item.id);
            // Every segment is optional except entityLabel, so a missing
            // lookup (a stale subject, or PO_SUGGESTION's no-data case)
            // degrades to a shorter line instead of an empty/broken one.
            const subtitle = [
              ctx?.entityLabel ?? item.subjectType.replaceAll("_", " ").toLowerCase(),
              ctx?.identifier,
              ctx?.detail,
              `opened ${item.openedAt.toLocaleDateString()}`,
            ]
              .filter(Boolean)
              .join(" · ");
            const body = (
              <div className="flex flex-1 items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    {ACTION_LABELS[item.actionType] ?? item.actionType}
                  </p>
                  <p className="text-xs text-zinc-500">{subtitle}</p>
                </div>
                {ctx?.href && <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />}
              </div>
            );
            return (
              <li key={item.id}>
                {ctx?.href ? (
                  <Link href={ctx.href} className="flex hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
