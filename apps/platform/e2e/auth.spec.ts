import { test, expect } from "@playwright/test";

test("unauthenticated visitors are redirected to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("wrong password shows an error and does not sign in", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', "buyer@acme.test");
  await page.fill('input[name="password"]', "wrong-password");
  await page.click('button:has-text("Sign in")');
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("correct credentials sign in and land on the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', "buyer@acme.test");
  await page.fill('input[name="password"]', "zenosource-dev");
  await page.click('button:has-text("Sign in")');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("header")).toContainText("Jordan Buyer");
});
