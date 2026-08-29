import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/login";

// The capability model, end to end.
//
// docs/architecture.md calls the registry "the actual extensibility point of
// the platform", and the claim it makes is behavioural, not structural: a
// feature appears because something supplies it and disappears when that
// stops. Unit tests cover the resolution; these cover the part a customer
// experiences — that nothing is switched on by hand, and that a failed
// connection says which of the two credentials was wrong.

test("an owner sees what's connected, what isn't, and what that costs them", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard/integrations");

  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Epicor Kinetic" })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Okta" })).toBeVisible();
  await expect(page.getByText("Phase 3 builds it")).toHaveCount(0);

  await expect(page.getByText("Single sign-on (OIDC)")).toBeVisible();
  await expect(page.getByText("Directory provisioning (SCIM)")).toBeVisible();
  // Connecting an identity provider must not reach into procurement features.
  await expect(page.getByText("PO suggestions", { exact: true })).toHaveCount(0);
  await expect(page.getByText("ERP purchase-order sync")).toHaveCount(0);
});

test("the connect form asks for both credentials and marks every field", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard/integrations");

  // Every control labelled — the Wave 1 rule, which matters most on a form
  // filled in once from values read off two different Epicor screens.

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

  // And the rest of the form survived — a failed submit costs a keystroke,
  // not a re-entry.
  await expect(page.getByLabel("Company ID")).toHaveValue("EPIC06");
  await expect(page.getByLabel("Service account user name")).toHaveValue("svc-zenosource");
});

test("an unreachable server is reported as unreachable, not as bad credentials", async ({ page }) => {
  // The distinction Phase 2 exists to get right: re-entering a password does
  // nothing for a server that never answered, and sending an admin to do it
  // costs a support cycle during onboarding.
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
  // Explicitly not the other message — that's the whole point of the check.
  await expect(alert).not.toContainText(/API Key Maintenance/i);
});

test("a member gets the page read-only, with no connect form at all", async ({ page }) => {
  // Not a form that renders in full and refuses on submit — the pattern the
  // audit kept finding, and Phase 1b Wave 5 removed everywhere else.
  await loginAs(page, "casey@acme.test", "zenosource-dev");
  await page.goto("/dashboard/integrations");

  await expect(page.getByText("Read-only for you")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect and test" })).toHaveCount(0);
  await expect(page.getByLabel("API key")).toHaveCount(0);
});
