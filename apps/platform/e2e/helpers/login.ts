import { expect, type Page } from "@playwright/test";

export async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button:has-text("Sign in")');
  await expect(page).toHaveURL(/\/dashboard$/);
}

/**
 * Every irreversible action in the app is behind a native `<dialog>` that
 * names its consequence — see src/components/forms.tsx. Opening the trigger
 * and confirming is therefore a two-step interaction everywhere, and this is
 * that interaction.
 */
export async function confirmAction(page: Page, trigger: string, confirmLabel: string) {
  await page.getByRole("button", { name: trigger, exact: false }).first().click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: confirmLabel, exact: false }).click();
}
