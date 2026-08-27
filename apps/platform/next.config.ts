import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Next locks a dev server to its build dir, not its port: two `next dev`
  // against the same `.next` fail outright.
  distDir: process.env.E2E_DIST_DIR || ".next",

  // The connectors ship as TypeScript source, with no build step of their own.
  transpilePackages: ["@zenosource/epicor", "@zenosource/okta"],

  // The XML stack under the SAML verifier is CommonJS and reaches for Node
  // builtins at load time, so bundled it fails at the first assertion.
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
    // Turbopack will not follow a symlink outside its filesystem root, and the
    // connectors are `file:` dependencies symlinked to sibling subprojects.
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
