import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/login";

test("an owner sees what's connected, what isn't, and what that costs them", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard/integrations");

  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Epicor Kinetic" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Okta" })).toBeVisible();
  await expect(page.getByText("Phase 3 builds it")).toHaveCount(0);

  // The seed connects an identity provider and leaves the ERP unconnected.
  await expect(page.getByText("Single sign-on (OIDC)")).toBeVisible();
  await expect(page.getByText("Directory provisioning (SCIM)")).toBeVisible();
  // Connecting an identity provider must not reach into procurement features.
  await expect(page.getByText("PO suggestions", { exact: true })).toHaveCount(0);
  await expect(page.getByText("ERP purchase-order sync")).toHaveCount(0);
});

test("the connect form asks for both credentials and marks every field", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard/integrations");

  await expect(page.getByLabel("Kinetic server URL")).toBeVisible();
  await expect(page.getByLabel("Company ID")).toBeVisible();
  await expect(page.getByLabel("API key")).toBeVisible();
  await expect(page.getByLabel("Service account user name")).toBeVisible();
});

test("a bad URL fails the field, and keeps everything else typed in", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard/integrations");

  await page.getByLabel("Kinetic server URL").fill("http://kinetic.example.com/Prod");
  await page.getByLabel("Company ID").fill("EPIC06");
  await page.getByLabel("API key").fill("a-key");
  await page.getByLabel("Service account user name").fill("svc-zenosource");
  await page.getByLabel("Service account password").fill("hunter2");
  await page.getByRole("button", { name: "Connect and test" }).click();

  // An ERP service account can't travel in cleartext.
  await expect(page.getByText(/Must be https/i)).toBeVisible();

  await expect(page.getByLabel("Company ID")).toHaveValue("EPIC06");
  await expect(page.getByLabel("Service account user name")).toHaveValue("svc-zenosource");
});

test("an unreachable server is reported as unreachable, not as bad credentials", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard/integrations");

  // Port 9 discards everything; nothing there will ever judge a credential.
  await page.getByLabel("Kinetic server URL").fill("https://127.0.0.1:9/Prod");
  await page.getByLabel("Company ID").fill("EPIC06");
  await page.getByLabel("API key").fill("a-key");
  await page.getByLabel("Service account user name").fill("svc-zenosource");
  await page.getByLabel("Service account password").fill("hunter2");
  await page.getByRole("button", { name: "Connect and test" }).click();

  const alert = page.getByRole("alert").first();
  await expect(alert).toContainText(/Nothing is wrong with the credentials/i, { timeout: 45_000 });
  await expect(alert).not.toContainText(/API Key Maintenance/i);
});

test("a member gets the page read-only, with no connect form at all", async ({ page }) => {
  await loginAs(page, "casey@acme.test", "zenosource-dev");
  await page.goto("/dashboard/integrations");

  await expect(page.getByText("Read-only for you")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect and test" })).toHaveCount(0);
  await expect(page.getByLabel("API key")).toHaveCount(0);
});
