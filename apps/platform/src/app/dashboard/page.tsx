import { getCurrentInternalUser } from "@/lib/dal";
import { listOpenActionItemsForInternalUser } from "@/lib/action-items";

const ACTION_LABELS: Record<string, string> = {
  PO_ACKNOWLEDGE: "Acknowledge purchase order",
  PO_REVIEW_CHANGE_PROPOSAL: "Review supplier-proposed change",
  PO_REVIEW_REJECTION: "Review rejected purchase order",
  RFQ_SUBMIT_QUOTE: "Submit RFQ quote",
  RFQ_AWARD_DECISION: "Decide RFQ award",
  PO_SUGGESTION_REVIEW: "Review PO suggestion",
};

export default async function DashboardPage() {
  const user = await getCurrentInternalUser();
  const items = user ? await listOpenActionItemsForInternalUser(user.id) : [];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
        Open action items
      </h1>
      <p className="mb-6 text-sm text-zinc-500">
        Everything below is something only you can move forward.
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing open right now.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                  {ACTION_LABELS[item.actionType] ?? item.actionType}
                </p>
                <p className="text-xs text-zinc-500">
                  {item.subjectType.replaceAll("_", " ").toLowerCase()} · opened{" "}
                  {item.openedAt.toLocaleDateString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
