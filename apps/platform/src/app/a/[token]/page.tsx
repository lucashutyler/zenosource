import { findOpenActionItemByToken } from "@/lib/action-items";
import { resolveActionItemByToken } from "@/app/actions/action-items";
import { db } from "@/lib/db";
import { PoResponseForm } from "./po-response-form";

const ACTION_LABELS: Record<string, string> = {
  PO_ACKNOWLEDGE: "Respond to this purchase order",
  PO_REVIEW_CHANGE_PROPOSAL: "Review the proposed change",
  RFQ_SUBMIT_QUOTE: "Submit your quote",
};

export default async function ActionViewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const item = await findOpenActionItemByToken(token);

  const resolve = async () => {
    "use server";
    await resolveActionItemByToken(token);
  };

  const po =
    item?.actionType === "PO_ACKNOWLEDGE"
      ? await db.purchaseOrder.findUnique({
          where: { id: item.subjectId },
          include: { lines: { include: { location: true }, orderBy: { lineNumber: "asc" } } },
        })
      : null;

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <div className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          ZenoSource
        </p>

        {!item ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            This item was already resolved, or the link is no longer valid. No account
            needed — if you still owe a response, ask your contact to resend the link.
          </p>
        ) : (
          <>
            <h1 className="mb-4 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              {ACTION_LABELS[item.actionType] ?? item.actionType}
            </h1>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Requested from {item.externalOwner?.name ?? "you"} at{" "}
              {item.externalOwner?.supplier?.name ?? "your company"}. No account or
              sign-in required — this link is yours alone for this one item.
            </p>

            {po && (
              <table className="mb-6 w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                    <th className="py-1">Item</th>
                    <th className="py-1">Qty</th>
                    <th className="py-1">Price</th>
                    <th className="py-1">Ship to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {po.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="py-2">
                        <p className="text-zinc-950 dark:text-zinc-50">{line.itemNumber}</p>
                        <p className="text-xs text-zinc-500">{line.description}</p>
                      </td>
                      <td className="py-2">
                        {line.quantity.toString()} {line.uom}
                      </td>
                      <td className="py-2">${line.unitPrice.toString()}</td>
                      <td className="py-2">{line.location?.name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {item.actionType === "PO_ACKNOWLEDGE" ? (
              <PoResponseForm token={token} />
            ) : (
              <form action={resolve}>
                <button
                  type="submit"
                  className="w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
                >
                  Acknowledge
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
