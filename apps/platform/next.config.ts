import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Next locks dev/build to the project directory via its build dir, not
  // the port — running `next dev` twice against the same `.next` (e.g. the
  // E2E suite's own server alongside a manually-running `npm run dev`)
  // fails outright. Route the E2E server to its own build dir so both can
  // run at once without the E2E suite killing your local dev session.
  distDir: process.env.E2E_DIST_DIR || ".next",

  // The Epicor connector is a sibling subproject
  // (integrations/erp/epicor), linked in as a file: dependency and shipped
  // as TypeScript source rather than a build artifact. It has no build step
  // of its own on purpose: a compiled package would need a watch process in
  // dev and a build ordering in CI, for a package that only ever runs inside
  // this app's own bundle. docs/architecture.md's "independently deployable"
  // is about the boundary being clean, which the connector contract enforces
  // — not about it having a separate build.
  transpilePackages: ["@zenosource/epicor", "@zenosource/okta"],

  // The XML stack under the SAML verifier is CommonJS and reaches for Node
  // builtins at load time; bundled, it fails at the first assertion.
  serverExternalPackages: [
    "@node-saml/node-saml",
    "@xmldom/xmldom",
    "xml-crypto",
    "xml-encryption",
    "xml2js",
    "xmlbuilder",
    "xpath",
  ],

  turbopack: {
    // Turbopack resolves modules relative to a filesystem root and will not
    // follow a link outside it — the documented behaviour for exactly this
    // case (`node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md`,
    // "Filesystem Root"). `@zenosource/epicor` is a `file:` dependency
    // symlinked to a sibling subproject, so the root has to be the repo, not
    // this app. Everything still *builds* per subproject; this only widens
    // what the bundler is allowed to read.
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
