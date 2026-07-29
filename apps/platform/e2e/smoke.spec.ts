import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { loginAs } from "./helpers/login";
import { withTestDb } from "./helpers/db";

/**
 * Every route, visited, with the browser console treated as a failure.
 *
 * This exists because of a bug that shipped: `PriceListDetailsForm` was handed
 * a whole Prisma record, dragging a `Decimal` — a class instance — across the
 * Client Component boundary. React only complains in the browser console, and
 * the price-list detail page had no spec, so nothing was watching. Three
 * instances of the same mistake were fixed one at a time by hand before it
 * became obvious the missing thing was a sweep, not more care.
 *
 * The rule this enforces is broader than that one bug: no route may log a
 * console error, and no route may fall through to its error boundary. Any page
 * added later is covered by adding one line to ROUTES.
 */

const SERIALIZATION_HINT = "Only plain objects can be passed to Client Components";

/** Noise that isn't ours, or is a guard working rather than failing. */
function isIgnorable(message: ConsoleMessage): boolean {
  const text = message.text();
  return (
    // Turbopack/HMR chatter and favicon 404s in dev.
    text.includes("Download the React DevTools") ||
    text.includes("[Fast Refresh]") ||
    /favicon\.ico/.test(text) ||
    // The dev mailbox renders captured email HTML in a `sandbox=""` iframe.
    // Chrome logs this whenever such a frame would run a script — which is the
    // sandbox doing its job on untrusted content, not a defect. Suppressing it
    // here rather than loosening the sandbox.
    text.includes("Blocked script execution in 'about:srcdoc'")
  );
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    if (isIgnorable(message)) return;
    // Serialization complaints arrive as errors in dev and warnings in build;
    // either way they mean a class instance reached a client component.
    if (message.type() === "error" || message.text().includes(SERIALIZATION_HINT)) {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function firstIdOf(table: string): Promise<string | null> {
  return withTestDb(async (client) => {
    const { rows } = await client.query(`SELECT "id" FROM "${table}" LIMIT 1`);
    return rows[0]?.id ?? null;
  });
}

test("every route renders clean for an owner", async ({ page }) => {
  const problems = watchConsole(page);
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  const [poId, rfqId, supplierId, priceListId, locationId, emailId] = await Promise.all([
    firstIdOf("PurchaseOrder"),
    firstIdOf("RFQ"),
    firstIdOf("Supplier"),
    firstIdOf("PriceList"),
    firstIdOf("Location"),
    firstIdOf("CapturedEmail"),
  ]);

  const ROUTES: [label: string, url: string][] = [
    ["chase", "/dashboard"],
    ["po list", "/dashboard/purchase-orders"],
    ["po new", "/dashboard/purchase-orders/new"],
    ["rfq list", "/dashboard/rfqs"],
    ["rfq new", "/dashboard/rfqs/new"],
    ["scorecards", "/dashboard/reports"],
    ["price lists", "/dashboard/price-lists"],
    ["price list new", "/dashboard/price-lists/new"],
    ["suppliers", "/dashboard/suppliers"],
    ["supplier new", "/dashboard/suppliers/new"],
    ["locations", "/dashboard/locations"],
    ["location new", "/dashboard/locations/new"],
    ["team", "/dashboard/team"],
    ["emails", "/dashboard/emails"],
    ["about", "/about"],
    ...(poId ? ([["po detail", `/dashboard/purchase-orders/${poId}`]] as [string, string][]) : []),
    ...(rfqId ? ([["rfq detail", `/dashboard/rfqs/${rfqId}`]] as [string, string][]) : []),
    ...(supplierId
      ? ([["supplier detail", `/dashboard/suppliers/${supplierId}`]] as [string, string][])
      : []),
    ...(priceListId
      ? ([["price list detail", `/dashboard/price-lists/${priceListId}`]] as [string, string][])
      : []),
    ...(locationId
      ? ([["location detail", `/dashboard/locations/${locationId}`]] as [string, string][])
      : []),
    ...(emailId ? ([["email detail", `/dashboard/emails/${emailId}`]] as [string, string][]) : []),
  ];

  const brokenRoutes: string[] = [];
  for (const [label, url] of ROUTES) {
    await page.goto(url);
    // The error boundary rendering is the loudest possible signal that a page
    // threw, and it's silent in the HTTP status (see dashboard/not-found.tsx).
    if (await page.getByText("That didn't load.").count()) {
      brokenRoutes.push(`${label} (${url}) fell through to its error boundary`);
    }
  }

  expect(brokenRoutes, brokenRoutes.join("\n")).toHaveLength(0);
  expect(problems, `console errors:\n${problems.join("\n")}`).toHaveLength(0);
});

test("every route a member can reach renders clean, and none leak scope", async ({ page }) => {
  const problems = watchConsole(page);
  await loginAs(page, "casey@acme.test", "zenosource-dev");

  // A MEMBER hits different branches on nearly every page — hidden actions,
  // narrower scope, the owner-only refusals — and those branches were where
  // the audit found forms that rendered in full and only said no on submit.
  const ROUTES = [
    "/dashboard",
    "/dashboard/purchase-orders",
    "/dashboard/purchase-orders/new",
    "/dashboard/rfqs",
    "/dashboard/reports",
    "/dashboard/price-lists",
    "/dashboard/suppliers",
    "/dashboard/locations",
    "/dashboard/locations/new",
    "/dashboard/team",
  ];

  const broken: string[] = [];
  for (const url of ROUTES) {
    await page.goto(url);
    if (await page.getByText("That didn't load.").count()) broken.push(url);
  }

  expect(broken, broken.join("\n")).toHaveLength(0);
  expect(problems, `console errors:\n${problems.join("\n")}`).toHaveLength(0);

  // Owners manage locations; a member is told so up front rather than after
  // filling the form in.
  await page.goto("/dashboard/locations/new");
  await expect(page.getByText("Owners manage locations.")).toBeVisible();
  await expect(page.locator('input[name="code"]')).toHaveCount(0);
});
