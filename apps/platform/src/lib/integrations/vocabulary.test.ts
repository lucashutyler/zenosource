import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Scoped to protocol and API shapes, never to vendor names: "Okta" and "Epicor" appear
// deliberately in registry entries, feature copy, and error messages a buyer's admin reads.

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

const FORBIDDEN: { pattern: RegExp; what: string }[] = [
  { pattern: /urn:ietf:params:scim:/, what: "a directory-protocol schema identifier" },
  { pattern: /\bstartIndex\b/, what: "a directory-protocol paging parameter" },
  { pattern: /urn:oasis:names:tc:SAML/, what: "an assertion-protocol namespace" },
  {
    pattern: /\b(EntityDescriptor|SPSSODescriptor|IDPSSODescriptor|AssertionConsumerService|NameIDPolicy|SubjectConfirmationData|AudienceRestriction)\b/,
    what: "an assertion-document element name",
  },
  { pattern: /\bSAMLResponse\b|\bSAMLRequest\b|\bRelayState\b/, what: "an assertion-binding parameter" },
  {
    pattern: /\b(code_challenge|code_verifier|id_token|at_hash|client_secret|grant_type|response_type)\b/,
    what: "a token-protocol wire parameter",
  },
  { pattern: /\.well-known\/openid-configuration/, what: "a token-protocol discovery path" },
  {
    pattern: /\b(POSuggSvc|POHeader|PODetail|PORel|VendorSvc|VendPartSvc|POSvc)\b/,
    what: "an ERP business-object name",
  },
  { pattern: /\$filter=|\$top=|\$skip=/, what: "an ERP query fragment" },
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    // Generated Prisma output embeds the whole schema as a string, comments included.
    if (entry === "generated") continue;
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // A test is allowed to name what it is testing — this file, most of all.
    if (/\.test\.tsx?$/.test(entry)) continue;
    found.push(full);
  }
  return found;
}

describe("no vendor protocol vocabulary in apps/platform/src", () => {
  const files = sourceFiles(SRC);

  it("scans a plausible number of files, so a broken walk fails loudly", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const { pattern, what } of FORBIDDEN) {
    it(`contains no ${what}`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        const source = readFileSync(file, "utf8");
        if (pattern.test(source)) offenders.push(path.relative(ROOT, file));
      }
      expect(
        offenders,
        `${what} (${pattern}) appears in platform code. It belongs in the integration ` +
          `subproject — see the connector contracts in src/lib/integrations/. If a second ` +
          `integration of the same kind arrived, this is the code that would have to change.`
      ).toEqual([]);
    });
  }
});
