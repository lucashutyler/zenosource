import { test, expect, type Page } from "@playwright/test";
import {
  findLocationByCode,
  findPurchaseOrderAtLocation,
  findPurchaseOrderLine,
  findPurchaseOrderLineById,
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
  await expect(page).toHaveURL(/\/dashboard\/purchase-orders\/[a-z0-9]+$/);
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
