import { NextResponse } from "next/server";
import { getCurrentInternalUser } from "@/lib/dal";
import { db } from "@/lib/db";

// Tenant-scoped supplier list for the one control that loads its options on
// demand (inviting an extra supplier to an existing RFQ). `getCurrentInternalUser`
// is the enforcement point here exactly as it is in a page — a Route Handler
// gets no free pass on the DAL.
export async function GET() {
  const user = await getCurrentInternalUser();
  const suppliers = await db.supplier.findMany({
    where: { tenantId: user.tenantId, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(suppliers);
}
