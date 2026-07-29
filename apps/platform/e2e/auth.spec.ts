import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/login";

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
  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await expect(page.locator("header")).toContainText("Jordan Buyer");
});

/**
 * The bug this closes: the user menu's container carried
 * `onClick={() => setOpen(false)}`, which unmounted the logout `<form>`
 * before the browser dispatched the button's submit event. The menu closed,
 * the server action never ran, and the session cookie survived — so the next
 * person at a shared workstation was still signed in as you.
 *
 * Asserting on the cookie rather than the redirect, because the redirect
 * happened either way; only the cookie tells you whether anything was
 * actually revoked.
 */
test("signing out actually clears the session", async ({ page, context }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");

  const before = await context.cookies();
  expect(before.some((c) => c.name === "session" && c.value.length > 0)).toBe(true);

  await page.getByRole("button", { name: /Jordan Buyer/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  const after = await context.cookies();
  expect(after.some((c) => c.name === "session" && c.value.length > 0)).toBe(false);

  // And the session is genuinely gone server-side, not merely hidden.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("the user menu shows which organization and scope you're in", async ({ page }) => {
  // "Why is my list empty" should never need a support ticket: a MEMBER can
  // see their own scope without asking anyone.
  await loginAs(page, "casey@acme.test", "zenosource-dev");
  await page.getByRole("button", { name: /Casey Buyer/ }).click();
  await expect(page.getByRole("menu")).toContainText("Acme Manufacturing (demo)");
  await expect(page.getByRole("menu")).toContainText("Member");
});
