import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/login";
import { withTestDb } from "./helpers/db";

// Federated sign-in, in a real browser, against the scripted identity provider
// Playwright starts on port 3101. No Okta org, no network.
//
// The seeded connection points at that server (prisma/seed.ts) and the seeded
// tenant claims @acme.test, so this exercises the whole chain a customer
// would: domain to tenant, tenant to connection, connection to identity
// provider, and back through a callback that has to answer a request we made.
//
// ── Order matters in exactly one place, and it is called out below ──
// Signing in through an identity provider as somebody who already had a
// password *adopts* their account and removes the password, on purpose: a
// second, unmanaged way into an account the directory now controls means
// disabling somebody at the identity provider would not actually disable them.
// That is worth asserting, and it destroys a fixture every other spec in this
// suite signs in with — so it is the last test in the file and nothing after
// it uses a password.

// The sign-in route pulls in the connector, and the connector pulls in an XML
// signature stack — so the E2E server, which is `next dev`, spends a few
// seconds compiling it the first time anyone asks. Paying that here rather
// than inside an assertion keeps a slow first compile from reading as a failed
// sign-in.
test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
  for (const route of ["/api/sso/acme/start", "/api/sso/acme/callback", "/api/sso/acme/metadata"]) {
    await request.get(route, { maxRedirects: 0 }).catch(() => undefined);
  }
  await request.dispose();
});

async function signInThroughIdp(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login/sso");
  await page.fill('input[name="email"]', email);
  await page.click('button:has-text("Continue")');
}

test("somebody the directory knows and we don't is signed in and given nothing", async ({
  page,
}) => {
  // dana@acme.test exists at the identity provider and nowhere here. Being
  // able to sign in is not being handed somebody's purchase orders, so she
  // arrives as a member with no locations — and src/lib/access.ts gives an
  // unassigned member an empty board, which is the right default.
  await signInThroughIdp(page, "dana@acme.test");

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("header")).toContainText("Dana Reed");

  const provisioned = await withTestDb(async (client) => {
    const { rows } = await client.query(
      `SELECT u."role", u."passwordHash", u."externalRef",
              (SELECT count(*) FROM "InternalUserLocation" l WHERE l."internalUserId" = u."id") AS locations
         FROM "InternalUser" u WHERE u."email" = 'dana@acme.test'`
    );
    return rows[0];
  });
  expect(provisioned.role).toBe("MEMBER");
  expect(provisioned.passwordHash).toBeNull();
  expect(provisioned.externalRef).toBe("00uNEWSTARTER");
  expect(Number(provisioned.locations)).toBe(0);
});

test("the session is a real one, indistinguishable from a password sign-in", async ({
  page,
  context,
}) => {
  await signInThroughIdp(page, "dana@acme.test");
  await expect(page).toHaveURL(/\/dashboard$/);

  const cookies = await context.cookies();
  expect(cookies.some((c) => c.name === "session" && c.value.length > 0)).toBe(true);
  // And the short-lived binding cookie is gone: the request it belonged to is
  // spent, and leaving it would be a credential with nothing left to do.
  expect(cookies.some((c) => c.name === "zs_sso" && c.value.length > 0)).toBe(false);
});

test("password sign-in keeps working alongside it", async ({ page }) => {
  // The most common way an SSO rollout locks a customer out of their own
  // account is by becoming the only door. It never becomes the only door.
  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await expect(page.locator("header")).toContainText("Jordan Buyer");
});

test("an address we don't route says so without confirming anything", async ({ page }) => {
  await signInThroughIdp(page, "someone@not-a-customer.test");

  await expect(page.getByText(/don't have single sign-on set up/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login\/sso/);
});

test("a callback nobody asked for is refused", async ({ page }) => {
  // No request row, no browser binding — the two things a real callback has.
  // This is what replaying a captured URL looks like.
  await page.goto("/api/sso/acme/callback?code=made-up&state=made-up");
  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.getByText(/expired or was already used/i)).toBeVisible();
});

test("a sign-in cannot be replayed", async ({ page, context }) => {
  await signInThroughIdp(page, "dana@acme.test");
  await expect(page).toHaveURL(/\/dashboard$/);

  const handle = await withTestDb(async (client) => {
    const { rows } = await client.query(
      `SELECT "handle" FROM "SsoAuthRequest" ORDER BY "createdAt" DESC LIMIT 1`
    );
    return rows[0]?.handle as string | undefined;
  });
  expect(handle).toBeTruthy();

  await context.clearCookies();
  await page.goto(`/api/sso/acme/callback?code=whatever&state=${encodeURIComponent(handle!)}`);
  await expect(page).toHaveURL(/\/login\?/);
  const cookies = await context.cookies();
  expect(cookies.some((c) => c.name === "session" && c.value.length > 0)).toBe(false);
});

test("an owner can see exactly what to configure at their end", async ({ page }) => {
  await loginAs(page, "buyer@acme.test", "zenosource-dev");
  await page.goto("/dashboard/integrations/sso");

  await expect(page.getByRole("heading", { name: "Single sign-on" })).toBeVisible();
  // Tenant-specific, and that is the multi-tenancy control rather than
  // tidiness: an assertion minted for one customer names an audience another
  // cannot use.
  await expect(page.getByText("/api/sso/acme/callback")).toBeVisible();
  await expect(page.getByText("/api/scim/v2")).toBeVisible();
});

test("a member cannot manage single sign-on", async ({ page }) => {
  await loginAs(page, "casey@acme.test", "zenosource-dev");
  await page.goto("/dashboard/integrations/sso");
  await expect(page.getByText("Read-only for you")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create token" })).toHaveCount(0);
});

// LAST, deliberately — see the note at the top of this file. This one removes
// casey@acme.test's password, which every earlier spec relies on.
test("signing in through the directory takes the password away", async ({ page, context }) => {
  await signInThroughIdp(page, "casey@acme.test");
  await expect(page).toHaveURL(/\/dashboard$/);
  // Adopted, not duplicated: the same row, keeping every purchase order they
  // issued and every item they resolved.
  await expect(page.locator("header")).toContainText("Casey Buyer");

  const adopted = await withTestDb(async (client) => {
    const { rows } = await client.query(
      `SELECT "passwordHash", "externalRef", "role" FROM "InternalUser" WHERE "email" = 'casey@acme.test'`
    );
    return rows[0];
  });
  expect(adopted.passwordHash).toBeNull();
  expect(adopted.externalRef).toBe("00uSEEDCASEY");
  // Adoption changes how somebody signs in, never what they may do.
  expect(adopted.role).toBe("MEMBER");

  // And the old password genuinely stops working, which is the whole point:
  // leaving it would keep a way in that the directory cannot close.
  await context.clearCookies();
  await page.goto("/login");
  await page.fill('input[name="email"]', "casey@acme.test");
  await page.fill('input[name="password"]', "zenosource-dev");
  await page.click('button:has-text("Sign in")');
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});
