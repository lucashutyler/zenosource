import Link from "next/link";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";
import { Card, PageHeader, LinkButton, Badge, Select } from "@/components/ui";
import type { Prisma } from "@/generated/prisma/client";
import type { RFQStatus } from "@/generated/prisma/enums";

const STATUS_TONE: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  SENT: "warning",
  RESPONSES_OPEN: "warning",
  AWARDED: "success",
  CLOSED: "neutral",
};

export default async function RFQsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string }>;
}) {
  const { status, sort } = await searchParams;
  const user = await getCurrentInternalUser();
  if (!user) return null;

  const where: Prisma.RFQWhereInput = {
    tenantId: user.tenantId,
    ...(status ? { status: status as RFQStatus } : {}),
  };

  const rfqs = await db.rFQ.findMany({
    where,
    include: { _count: { select: { lines: true, invites: true } } },
    orderBy: { createdAt: sort === "oldest" ? "asc" : "desc" },
  });

  return (
    <div>
      <PageHeader
        title="RFQs"
        action={<LinkButton href="/dashboard/rfqs/new">New RFQ</LinkButton>}
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Status</label>
          <Select name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {Object.keys(STATUS_TONE).map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">Sort</label>
          <Select name="sort" defaultValue={sort ?? "newest"}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </Select>
        </div>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
        >
          Apply
        </button>
      </form>

      {rfqs.length === 0 ? (
        <p className="text-sm text-zinc-500">No RFQs match these filters.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rfqs.map((rfq) => (
              <li key={rfq.id}>
                <Link
                  href={`/dashboard/rfqs/${rfq.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                      RFQ-{rfq.id.slice(-6).toUpperCase()}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {rfq._count.lines} line{rfq._count.lines === 1 ? "" : "s"} ·{" "}
                      {rfq._count.invites} supplier{rfq._count.invites === 1 ? "" : "s"} invited ·{" "}
                      {rfq.createdAt.toLocaleDateString()}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[rfq.status] ?? "neutral"}>
                    {rfq.status.replaceAll("_", " ").toLowerCase()}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
