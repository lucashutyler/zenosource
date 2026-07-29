import { test, expect, type Page } from "@playwright/test";
import { createTestAcknowledgeItem } from "./helpers/db";

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button:has-text("Sign in")');
  await expect(page).toHaveURL(/\/dashboard$/);
}

// The dev mailbox end to end: run the reminder job from the page, open the
// captured supplier digest, and follow its /a/{token} link into the action
// view. Uses a self-contained fixture item rather than the seeded one, since
// earlier specs may have resolved that (resolved items get no digest line).
test("reminder digests are captured and their action links resolve", async ({ page }) => {
  const fixture = await createTestAcknowledgeItem();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  await page.click('nav >> text=Emails (dev)');
  await expect(page).toHaveURL(/\/dashboard\/emails$/);

  await page.click('button:has-text("Run reminder job")');

  // The digest for our fixture's contact appears in the list.
  const row = page.locator(`a:has-text("to ${fixture.contactEmail}")`).first();
  await expect(row).toBeVisible();
  await row.click();

  // Detail view renders the body with the scoped action link clickable.
  const actionLink = page.locator(`a[href$="/a/${fixture.accessToken}"]`);
  await expect(actionLink).toBeVisible();
  await actionLink.click();

  await expect(page).toHaveURL(new RegExp(`/a/${fixture.accessToken}$`));
  await expect(page.getByText("Respond to this purchase order")).toBeVisible();
});
