import { test, expect, type Page } from "@playwright/test";
import {
  findLocationByCode,
  findPurchaseOrderAtLocation,
  findPurchaseOrderLine,
  findPurchaseOrderLineById,
  findActionItemById,
  createTestChangeProposalItem,
  createTestDraftPOForContactlessSupplier,
  createTestAcknowledgeItem,
  createTestReviewRejectionItem,
} from "./helpers/db";

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button:has-text("Sign in")');
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("owner can create, issue, and cancel a purchase order", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.goto("/dashboard/purchase-orders/new");
  await page.selectOption('select[name="supplierId"]', { index: 1 });
  await page.fill('input[name="itemNumber-0"]', "SKU-E2E");
  await page.fill('input[name="description-0"]', "E2E test widget");
  await page.fill('input[name="uom-0"]', "EA");
  await page.fill('input[name="quantity-0"]', "10");
  await page.fill('input[name="unitPrice-0"]', "1.50");
  await page.selectOption('select[name="locationId-0"]', { index: 1 });
  await page.click('button:has-text("Save draft")');
  // Negative lookahead on "new" — a bare `[a-z0-9]+` also matches the create
  // page's own URL (/purchase-orders/new), so this assertion could resolve
  // true before the redirect actually lands, on a slow enough submission.
  await expect(page).toHaveURL(/\/dashboard\/purchase-orders\/(?!new$)[a-z0-9]+$/);
  await expect(page.getByText("draft", { exact: true })).toBeVisible();

  await page.click('button:has-text("Issue to supplier")');
  await expect(page.getByText("issued", { exact: true })).toBeVisible();

  await page.fill('input[name="reason"]', "e2e cancel");
  await page.click('button:has-text("Cancel PO")');
  // Cancellation cascades to the (single) line too, so "cancelled" shows
  // twice on the page — once on the header badge, once on the line badge.
  // Both are correct; just don't demand a single match.
  await expect(page.getByText("cancelled", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("e2e cancel")).toBeVisible();
});

test("a MEMBER restricted to one location cannot see a PO at another location", async ({ page }) => {
  const dallas = await findLocationByCode("DAL-01");
  const dallasOnlyPO = await findPurchaseOrderAtLocation(dallas.id);

  await loginAs(page, "casey@acme.test", "zenosource-dev");

  // Not in Casey's (Chicago-only) list
  await page.goto("/dashboard/purchase-orders");
  await expect(page.locator(`a[href="/dashboard/purchase-orders/${dallasOnlyPO.id}"]`)).toHaveCount(0);

  // Direct navigation is blocked too, not just hidden from the list
  const response = await page.goto(`/dashboard/purchase-orders/${dallasOnlyPO.id}`);
  expect(response?.status()).toBe(404);
});

test("accepting a supplier-proposed change resolves the action item", async ({ page }) => {
  const line = await findPurchaseOrderLine("CHANGE_PROPOSED");

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto(`/dashboard/purchase-orders/${line.purchaseOrderId}`);
  await expect(page.getByText("proposed:")).toBeVisible();

  await page.click('button:has-text("Accept")');
  await expect(page.getByText("proposed:")).toHaveCount(0);

  const updated = await findPurchaseOrderLineById(line.id);
  expect(updated.status).toBe("ACKNOWLEDGED");
  expect(updated.proposedQuantity).toBeNull();
});

test("cancelling a PO resolves its line-level action items too, not just PO-level ones", async ({
  page,
}) => {
  const fixture = await createTestChangeProposalItem();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto(`/dashboard/purchase-orders/${fixture.poId}`);
  await page.fill('input[name="reason"]', "cancelling with an open proposal");
  await page.click('button:has-text("Cancel PO")');
  await expect(page.getByText("cancelled", { exact: true }).first()).toBeVisible();

  const item = await findActionItemById(fixture.id);
  expect(item.status).toBe("RESOLVED");
});

test("a MEMBER's ?locationId= filter can't be widened past their assigned scope", async ({
  page,
}) => {
  const dallas = await findLocationByCode("DAL-01");
  const dallasOnlyPO = await findPurchaseOrderAtLocation(dallas.id);

  await loginAs(page, "casey@acme.test", "zenosource-dev");

  // Casey is Chicago-only; hand-editing ?locationId= to Dallas's id must not
  // surface Dallas POs — the filter should narrow her scope, never replace it.
  await page.goto(`/dashboard/purchase-orders?locationId=${dallas.id}`);
  await expect(page.locator(`a[href="/dashboard/purchase-orders/${dallasOnlyPO.id}"]`)).toHaveCount(0);
});

test("an invalid ?status= value is ignored rather than 500ing", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  const response = await page.goto("/dashboard/purchase-orders?status=NOT_A_REAL_STATUS");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Purchase orders" })).toBeVisible();
});

test("issuing to a supplier with no contact is blocked, not silently accepted", async ({ page }) => {
  const { poId } = await createTestDraftPOForContactlessSupplier();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto(`/dashboard/purchase-orders/${poId}`);
  await page.click('button:has-text("Issue to supplier")');

  await expect(page.getByText(/has no contact on file/)).toBeVisible();
  // Still draft, and still offering Issue/Edit — nothing silently transitioned.
  await expect(page.getByText("draft", { exact: true })).toBeVisible();
});

test('the "needs your action" dot only lights up for items the viewer owns', async ({ page }) => {
  // Owned by the supplier, not by any internal user — same subject type
  // (PURCHASE_ORDER) as the dot's own query, so this isolates ownership as
  // the only variable.
  const externallyOwned = await createTestAcknowledgeItem();
  // Owned by the OWNER internal user (buyer@acme.test).
  const internallyOwned = await createTestReviewRejectionItem();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard/purchase-orders");

  await expect(
    page
      .locator(`a[href="/dashboard/purchase-orders/${externallyOwned.subjectId}"]`)
      .locator('span[title="Needs your action"]')
  ).toHaveCount(0);
  await expect(
    page
      .locator(`a[href="/dashboard/purchase-orders/${internallyOwned.poId}"]`)
      .locator('span[title="Needs your action"]')
  ).toHaveCount(1);
});
