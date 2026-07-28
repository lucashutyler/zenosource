import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next locks dev/build to the project directory via its build dir, not
  // the port — running `next dev` twice against the same `.next` (e.g. the
  // E2E suite's own server alongside a manually-running `npm run dev`)
  // fails outright. Route the E2E server to its own build dir so both can
  // run at once without the E2E suite killing your local dev session.
  distDir: process.env.E2E_DIST_DIR || ".next",
};

export default nextConfig;
