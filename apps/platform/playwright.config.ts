import { defineConfig, devices } from "@playwright/test";

// Runs against the test database on a dedicated port (3100) so it never
// touches whatever's running on the normal dev server (3000) or its data.
// `npm run test:e2e` seeds the test DB fresh before starting.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // shared DB state across specs — keep it sequential
  workers: 1,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "dotenv -e .env.test -- next dev -p 3100",
      url: "http://localhost:3100/login",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_DIST_DIR: ".next-e2e" }, // separate build dir — see next.config.ts
    },
    {
      // A separate process and not a route: an endpoint that mints signed
      // assertions and ships with the product is an authentication bypass.
      command: "dotenv -e .env.test -- tsx scripts/fake-idp.ts",
      url: "http://localhost:3101/.well-known/openid-configuration",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
