import { defineConfig, devices } from "@playwright/test";

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
      // A webServer rather than a globalSetup process, so Playwright waits for
      // the URL below and tears it down afterwards.
      command: "dotenv -e .env.test -- tsx scripts/fake-idp.ts",
      url: "http://localhost:3101/.well-known/openid-configuration",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
