import { test, expect } from "@playwright/test";
import { createTestChangeProposalItem, createTestAcknowledgeItem } from "./helpers/db";
import { loginAs } from "./helpers/login";

test("an inbox row identifies exactly which work item it concerns", async ({ page }) => {
  const fixture = await createTestChangeProposalItem();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard");

  // Scoped to this fixture's own href — the seed has other open
  // change-proposal items, so matching on label text alone would hit several.
  const link = page.locator(
    `a[href="/dashboard/purchase-orders/${fixture.poId}?highlight=${fixture.lineId}"]`
  );
  await expect(link).toBeVisible();

  // The row says what's owed, which document, and which line — a list of
  // "Purchase order line" with no way to tell them apart is not a board.
  const row = page.locator("tr", { has: link });
  await expect(row).toContainText(fixture.poNumber);
  await expect(row).toContainText("SKU-E2E-PROPOSAL");
  await expect(row).toContainText("change-proposal test line");

  await link.click();
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/purchase-orders/${fixture.poId}\\?highlight=${fixture.lineId}$`)
  );
});

// The question the product exists to answer, at display size. The
// "waiting on supplier" half did not exist anywhere in the product before
// Phase 1b — the dashboard could only ever show your own inbox.
test("the board leads with whose court the work is in, both halves", async ({ page }) => {
  await createTestAcknowledgeItem(); // guarantees at least one supplier-owed item

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard");

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toContainText("You owe");
  await expect(heading).toContainText("They owe");

  await expect(page.getByRole("heading", { name: "Your court" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Their court" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Chase all/ })).toBeVisible();
});

// `Chase all` aggregates by recipient and inherits runReminderJob's
// server-side cooldown, so pressing it twice must not send twice.
test("chase all reports what it did and refuses to double-send", async ({ page }) => {
  await createTestAcknowledgeItem();

  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard");

  await page.getByRole("button", { name: /^Chase all/ }).click();
  await expect(page.getByText(/Chased \d+ supplier/)).toBeVisible();

  await page.getByRole("button", { name: /^Chase all/ }).click();
  await expect(page.getByText(/already chased in the last 24 hours/)).toBeVisible();
});

test("a member with an empty board is told what they can still see", async ({ page }) => {
  await loginAs(page, "casey@acme.test", "zenosource-dev");
  await page.goto("/dashboard");

  // Casey either owes something or doesn't; when she doesn't, the screen has
  // to say so *and* say what's in her locations — a blank page while fifteen
  // in-scope orders sit one click away is the failure this replaces.
  const boardClear = page.getByText("Board clear.");
  if (await boardClear.isVisible().catch(() => false)) {
    await expect(page.getByText(/purchase order/)).toBeVisible();
  }
  // Either way the scope is legible from the chrome.
  await expect(page.getByText("Chicago Plant").first()).toBeVisible();
});
