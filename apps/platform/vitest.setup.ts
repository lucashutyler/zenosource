import { config } from "dotenv";
import path from "node:path";
import { vi } from "vitest";

// Tests always run against .env.test, never the dev database.
config({ path: path.resolve(__dirname, ".env.test") });

// server-only intentionally throws when imported outside Next's own
// bundler (which aliases it away) — that's the whole point of the
// package, but it means Vitest needs a no-op stand-in.
vi.mock("server-only", () => ({}));
