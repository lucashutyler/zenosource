import { test, expect, type Page } from "@playwright/test";
import { createTestChangeProposalItem } from "./helpers/db";

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button:has-text("Sign in")');
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("an inbox row identifies exactly which work item it concerns", async ({ page }) => {
  const fixture = await createTestChangeProposalItem();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard");

  // Scoped to this fixture's own href — the seed already has an unrelated
  // "Review supplier-proposed change" item (po2), so matching on label text
  // alone would hit both.
  const row = page.locator(
    `a[href="/dashboard/purchase-orders/${fixture.poId}?highlight=${fixture.lineId}"]`
  );
  await expect(row).toBeVisible();
  // Entity type, which supplier, and which line — not just "purchase order
  // line" with no way to tell it apart from any other open item.
  await expect(row).toContainText("Purchase order line");
  await expect(row).toContainText(fixture.supplierName);
  await expect(row).toContainText("SKU-E2E-PROPOSAL");
  await expect(row).toContainText("change-proposal test line");

  // And it's still a real link to the right place, highlighting the line.
  await row.click();
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/purchase-orders/${fixture.poId}\\?highlight=${fixture.lineId}$`)
  );
});
