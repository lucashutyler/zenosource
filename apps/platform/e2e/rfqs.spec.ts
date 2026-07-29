import { test, expect, type Page } from "@playwright/test";
import {
  findLocationByCode,
  findRFQAtLocation,
  findActionItemById,
  createTestRfqAwardItem,
  createContactlessSupplier,
  findOpenActionItemsForSubject,
} from "./helpers/db";

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button:has-text("Sign in")');
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("closing an RFQ resolves its open award-decision action item", async ({ page }) => {
  const fixture = await createTestRfqAwardItem();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto(`/dashboard/rfqs/${fixture.rfqId}`);
  await page.click('button:has-text("Close RFQ")');
  await expect(page.getByText("closed", { exact: true })).toBeVisible();

  const item = await findActionItemById(fixture.id);
  expect(item.status).toBe("RESOLVED");
});

test("a MEMBER restricted to one location cannot see an RFQ at another location", async ({ page }) => {
  const dallas = await findLocationByCode("DAL-01");
  const dallasOnlyRfq = await findRFQAtLocation(dallas.id);

  await loginAs(page, "casey@acme.test", "zenosource-dev");

  // Not in Casey's (Chicago-only) list
  await page.goto("/dashboard/rfqs");
  await expect(page.locator(`a[href="/dashboard/rfqs/${dallasOnlyRfq.id}"]`)).toHaveCount(0);

  // Direct navigation is blocked too, matching the PO detail page's pattern.
  const response = await page.goto(`/dashboard/rfqs/${dallasOnlyRfq.id}`);
  expect(response?.status()).toBe(404);
});

test("an invalid ?status= value on the RFQ list is ignored rather than 500ing", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  const response = await page.goto("/dashboard/rfqs?status=NOT_A_REAL_STATUS");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "RFQs" })).toBeVisible();
});

test("sending an RFQ creates an RFQ_SUBMIT_QUOTE item per invited supplier", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.goto("/dashboard/rfqs/new");
  await page.fill('input[name="itemNumber-0"]', "SKU-E2E-RFQ-SEND");
  await page.fill('input[name="description-0"]', "E2E RFQ send test");
  await page.fill('input[name="uom-0"]', "EA");
  await page.fill('input[name="quantity-0"]', "5");
  // Every seeded supplier has exactly one contact — any of them works here.
  await page.locator('input[name="supplierIds"]').first().check();
  await page.click('button:has-text("Save RFQ")');

  // Negative lookahead on "new" — a bare `[a-z0-9]+` also matches the create
  // page's own URL (/rfqs/new), so this assertion could resolve true before
  // the redirect actually lands; this action does enough extra DB work
  // (location/contact validation, one createActionItem per invited
  // supplier) to make that race actually reachable, not just theoretical.
  await expect(page).toHaveURL(/\/dashboard\/rfqs\/(?!new$)[a-z0-9]+$/);
  const rfqId = page.url().split("/").pop()!;

  const items = await findOpenActionItemsForSubject("RFQ", rfqId);
  expect(items.some((i) => i.actionType === "RFQ_SUBMIT_QUOTE")).toBe(true);
});

test("inviting a contact-less supplier to an RFQ is blocked, not silently accepted", async ({ page }) => {
  const supplier = await createContactlessSupplier();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard/rfqs/new");
  await page.fill('input[name="itemNumber-0"]', "SKU-E2E-RFQ-NOCONTACT");
  await page.fill('input[name="description-0"]', "E2E RFQ contactless test");
  await page.fill('input[name="uom-0"]', "EA");
  await page.fill('input[name="quantity-0"]', "5");
  await page.getByLabel(supplier.name).check();
  await page.click('button:has-text("Save RFQ")');

  await expect(page.getByText(/has no contact on file/)).toBeVisible();
  // Still on the create form — nothing was created.
  await expect(page).toHaveURL(/\/dashboard\/rfqs\/new$/);
});
