import { test, expect } from "@playwright/test";
import { createTestAcknowledgeItem } from "./helpers/db";
import { loginAs } from "./helpers/login";

// The dev mailbox end to end: run the chase from the page, open the captured
// supplier email, and follow its /a/{token} link into the action view. Uses a
// self-contained fixture rather than a seeded item, since earlier specs may
// have resolved those (resolved items get no chase).
test("the chase is captured, carries a real envelope, and its links resolve", async ({ page }) => {
  const fixture = await createTestAcknowledgeItem();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.click('nav >> text=Emails (dev)');
  await expect(page).toHaveURL(/\/dashboard\/emails$/);

  await page.click('button:has-text("Run the chase now")');

  const row = page.locator("tr", { hasText: fixture.contactEmail }).first();
  await expect(row).toBeVisible();

  // Two header fields, and the highest leverage-to-effort item in the whole
  // design review: the buyer's name leads, and a reply reaches a person.
  await expect(row).toContainText("via ZenoSource");
  await expect(row).toContainText("reply →");

  await row.getByRole("link").first().click();

  // The plain-text half still carries a clickable scoped action link.
  const actionLink = page.locator(`a[href$="/a/${fixture.accessToken}"]`);
  await expect(actionLink.first()).toBeVisible();

  // And the HTML half renders in a phone frame — the screen that ends the
  // "I never got it" conversation.
  await expect(page.getByRole("heading", { name: "As the supplier sees it" })).toBeVisible();
  await expect(page.locator('iframe[title="Email preview"]')).toBeVisible();

  await actionLink.first().click();
  await expect(page).toHaveURL(new RegExp(`/a/${fixture.accessToken}$`));
  await expect(page.getByRole("button", { name: /^Confirm/ })).toBeVisible();
});

// Issuing a purchase order used to send the supplier nothing at all — the
// only email producer in the app was the daily digest job.
test("issuing a purchase order emails the supplier immediately", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.goto("/dashboard/purchase-orders/new");
  await page.selectOption('select[name="supplierId"]', { index: 1 });
  await page.fill('input[name="itemNumber-0"]', "SKU-E2E-TRANSACTIONAL");
  await page.fill('input[name="description-0"]', "transactional send test");
  await page.fill('input[name="uom-0"]', "EA");
  await page.fill('input[name="quantity-0"]', "4");
  await page.fill('input[name="unitPrice-0"]', "5");
  await page.selectOption('select[name="locationId-0"]', { index: 1 });
  await page.click('button:has-text("Save as draft")');
  await expect(page).toHaveURL(/\/dashboard\/purchase-orders\/(?!new$)[a-z0-9]+$/);

  await page.getByRole("button", { name: "Issue to supplier" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Issue it" }).click();
  await expect(page.getByText("Issued", { exact: true }).first()).toBeVisible();

  await page.goto("/dashboard/emails");
  // The subject carries the commitment, not a count.
  await expect(page.getByText(/needs a date on P-\d+/).first()).toBeVisible();
});
