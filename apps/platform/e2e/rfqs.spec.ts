import { test, expect } from "@playwright/test";
import {
  findLocationByCode,
  findRFQAtLocation,
  findActionItemById,
  createTestRfqAwardItem,
  createContactlessSupplier,
  findOpenActionItemsForSubject,
} from "./helpers/db";
import { loginAs, confirmAction } from "./helpers/login";

test("closing an RFQ resolves its open award-decision action item", async ({ page }) => {
  const fixture = await createTestRfqAwardItem();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto(`/dashboard/rfqs/${fixture.rfqId}`);
  await confirmAction(page, "Close without awarding", "Close it");
  await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible();

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
  // Asserted on disclosure rather than status — see the PO spec for why.
  await page.goto(`/dashboard/rfqs/${dallasOnlyRfq.id}`);
  await expect(page.getByText("Nothing here.")).toBeVisible();
  await expect(page.getByText(dallasOnlyRfq.number)).toHaveCount(0);
});

test("an invalid ?status= value on the RFQ list is ignored rather than 500ing", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  const response = await page.goto("/dashboard/rfqs?status=NOT_A_REAL_STATUS");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Requests for quote" })).toBeVisible();
});

test("sending an RFQ creates an RFQ_SUBMIT_QUOTE item per invited supplier", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.goto("/dashboard/rfqs/new");
  await page.fill('input[name="itemNumber-0"]', "SKU-E2E-RFQ-SEND");
  await page.fill('input[name="description-0"]', "E2E RFQ send test");
  await page.fill('input[name="uom-0"]', "EA");
  await page.fill('input[name="quantity-0"]', "5");
  // Every seeded supplier has exactly one contact — any of them works here.
  await page.locator('input[name="supplierIds"]:not([disabled])').first().check();

  // `Save RFQ` was a lie of omission: that button emails suppliers and opens
  // external action items. The label now says what it does, and confirms.
  await confirmAction(page, "Send to 1 supplier", "Send it");

  // Negative lookahead on "new" — a bare `[a-z0-9]+` also matches the create
  // page's own URL (/rfqs/new), so this assertion could resolve true before
  // the redirect actually lands; this action does enough extra DB work
  // (location/contact validation, one createActionItem and one email per
  // invited supplier) to make that race actually reachable.
  await expect(page).toHaveURL(/\/dashboard\/rfqs\/(?!new$)[a-z0-9]+$/);
  const rfqId = page.url().split("/").pop()!;

  const items = await findOpenActionItemsForSubject("RFQ", rfqId);
  expect(items.some((i) => i.actionType === "RFQ_SUBMIT_QUOTE")).toBe(true);
});

test("an RFQ saved with nobody invited is a draft that says so, and can be sent later", async ({
  page,
}) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.goto("/dashboard/rfqs/new");
  await page.fill('input[name="itemNumber-0"]', "SKU-E2E-RFQ-DRAFT");
  await page.fill('input[name="description-0"]', "E2E RFQ draft test");
  await page.fill('input[name="uom-0"]', "EA");
  await page.fill('input[name="quantity-0"]', "5");
  await page.click('button:has-text("Save as draft")');

  await expect(page).toHaveURL(/\/dashboard\/rfqs\/(?!new$)[a-z0-9]+$/);
  await expect(page.getByText("Nobody has been asked yet")).toBeVisible();

  const rfqId = page.url().split("/").pop()!;
  const items = await findOpenActionItemsForSubject("RFQ", rfqId);
  // A draft is the buyer's own outstanding work, not an unowned state.
  expect(items.some((i) => i.actionType === "RFQ_SEND_DRAFT")).toBe(true);
});

test("inviting a contact-less supplier to an RFQ is blocked, not silently accepted", async ({
  page,
}) => {
  const supplier = await createContactlessSupplier();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard/rfqs/new");

  // The row says so up front rather than rejecting at submit time — the
  // checkbox for a supplier nobody can reach is disabled and labelled.
  const row = page.locator("label", { hasText: supplier.name });
  await expect(row).toContainText("no contact on file");
  await expect(row.locator('input[name="supplierIds"]')).toBeDisabled();
});

// The largest single gap in the product: an invited supplier got a page
// headed "Submit your quote" above an Acknowledge button that supplied no
// price, no lead time and no quote — so RESPONSES_OPEN was unreachable and
// the whole comparison surface said "no quotes yet" forever.
test("a supplier can actually submit a quote, and it reaches the comparison", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.goto("/dashboard/rfqs/new");
  await page.fill('input[name="itemNumber-0"]', "SKU-E2E-QUOTE");
  await page.fill('input[name="description-0"]', "E2E quotable line");
  await page.fill('input[name="uom-0"]', "EA");
  await page.fill('input[name="quantity-0"]', "100");
  await page.locator('input[name="supplierIds"]:not([disabled])').first().check();
  await confirmAction(page, "Send to 1 supplier", "Send it");
  await expect(page).toHaveURL(/\/dashboard\/rfqs\/(?!new$)[a-z0-9]+$/);
  const rfqUrl = page.url();
  const rfqId = rfqUrl.split("/").pop()!;

  const items = await findOpenActionItemsForSubject("RFQ", rfqId);
  const quoteItem = items.find((i) => i.actionType === "RFQ_SUBMIT_QUOTE")!;
  expect(quoteItem).toBeTruthy();

  // The supplier's side, with no session at all.
  const supplierPage = await page.context().newPage();
  await supplierPage.goto(`/a/${quoteItem.accessToken}`);
  const priceInput = supplierPage.locator('input[id^="price-"]').first();
  await priceInput.fill("2.50");
  await supplierPage.locator('input[id^="lead-"]').first().fill("14");
  await supplierPage.getByRole("button", { name: /Send my quote/ }).click();
  await expect(supplierPage.getByText("Quote sent.")).toBeVisible();
  await supplierPage.close();

  // And the buyer can see it, compare it, and award it.
  await page.goto(rfqUrl);
  await expect(page.getByText("$2.50")).toBeVisible();
  await expect(page.getByText("14 days lead")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Quoted total" })).toBeVisible();

  await confirmAction(page, "Award to", "Award it");
  // Awarding creates no purchase order, and the page says so *after* the fact
  // as well as in the confirm — scoped to the awarded callout so this can't
  // pass against the dialog copy it was just read from.
  await expect(page.getByText(/^Awarded to /)).toBeVisible();
  await expect(page.getByRole("link", { name: "Raise the PO" })).toBeVisible();

  const after = await findOpenActionItemsForSubject("RFQ", rfqId);
  expect(after.some((i) => i.actionType === "RFQ_RAISE_PO_FROM_AWARD")).toBe(true);
});

test("a supplier can decline instead of ignoring the request", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.goto("/dashboard/rfqs/new");
  await page.fill('input[name="itemNumber-0"]', "SKU-E2E-DECLINE");
  await page.fill('input[name="description-0"]', "E2E decline line");
  await page.fill('input[name="uom-0"]', "EA");
  await page.fill('input[name="quantity-0"]', "10");
  await page.locator('input[name="supplierIds"]:not([disabled])').first().check();
  await confirmAction(page, "Send to 1 supplier", "Send it");
  await expect(page).toHaveURL(/\/dashboard\/rfqs\/(?!new$)[a-z0-9]+$/);
  const rfqId = page.url().split("/").pop()!;

  const items = await findOpenActionItemsForSubject("RFQ", rfqId);
  const quoteItem = items.find((i) => i.actionType === "RFQ_SUBMIT_QUOTE")!;

  const supplierPage = await page.context().newPage();
  await supplierPage.goto(`/a/${quoteItem.accessToken}`);
  // A native <details> disclosure, so this works before hydration too.
  await supplierPage.getByText("I'm not quoting this one").click();
  await supplierPage.getByRole("button", { name: /^Yes/ }).click();
  await expect(supplierPage.getByText("Declined.")).toBeVisible();
  await supplierPage.close();

  const after = await findActionItemById(quoteItem.id);
  expect(after.status).toBe("RESOLVED");
});
