import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// `prisma/seed.ts` and `wipe-test-db.ts` both hold a full, FK-ordered
// deletion sequence, and both comments say to keep them in step. A comment is
// not a mechanism: adding IntegrationConnection updated one and not the
// other, and the symptom was the entire E2E suite failing in global setup on
// a foreign-key violation with nothing pointing at the cause.
//
// Cheap to assert, so assert it.

function deletionOrder(relativePath: string): string[] {
  const source = readFileSync(path.resolve(__dirname, "../../..", relativePath), "utf8");
  return [...source.matchAll(/db\.([a-zA-Z]+)\.deleteMany\(\)/g)].map((m) => m[1]);
}

describe("the two deletion sequences", () => {
  it("delete the same models in the same order", () => {
    const seed = deletionOrder("prisma/seed.ts");
    const wipe = deletionOrder("src/lib/testing/wipe-test-db.ts");

    expect(wipe.length).toBeGreaterThan(10);
    expect(
      seed,
      "prisma/seed.ts and src/lib/testing/wipe-test-db.ts have drifted — a model added to one " +
        "and not the other fails at runtime as a foreign-key violation during E2E global setup"
    ).toEqual(wipe);
  });
});
