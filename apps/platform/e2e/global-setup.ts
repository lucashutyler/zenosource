import { config } from "dotenv";
import path from "node:path";
import { execSync } from "node:child_process";

export default async function globalSetup() {
  config({ path: path.resolve(__dirname, "../.env.test") });

  if (!process.env.DATABASE_URL?.includes("zenosource_test")) {
    throw new Error("Refusing to run E2E tests — DATABASE_URL doesn't point at the test database.");
  }

  // Fresh, known data for every run — see prisma/seed.ts (idempotent: wipes
  // and recreates). Runs with the test DB's env explicitly, independent of
  // whatever's loaded in this process already.
  execSync("dotenv -e .env.test -- npx prisma db push", {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
  });
  execSync("dotenv -e .env.test -- tsx prisma/seed.ts", {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
  });
}
