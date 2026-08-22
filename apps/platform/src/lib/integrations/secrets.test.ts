import { describe, it, expect, beforeAll } from "vitest";
import { sealSecrets, openSecrets, hint } from "./secrets";

// These credentials are the highest-value rows in the database (see the
// header of secrets.ts). The properties worth pinning are the ones whose
// absence would be silent: that the ciphertext doesn't contain the plaintext,
// that two seals of the same input differ, and that tampering throws instead
// of yielding garbage that gets sent to a customer's ERP as a password.

beforeAll(() => {
  process.env.INTEGRATION_SECRET_KEY ||= Buffer.alloc(32, 7).toString("base64");
});

describe("sealing integration secrets", () => {
  it("round-trips", () => {
    const secrets = { apiKey: "abc-123", password: "hunter2" };
    expect(openSecrets(sealSecrets(secrets))).toEqual(secrets);
  });

  it("does not leave the plaintext in the sealed value", () => {
    const sealed = sealSecrets({ apiKey: "SUPERSECRETKEY", password: "hunter2" });
    expect(sealed).not.toContain("SUPERSECRETKEY");
    expect(sealed).not.toContain("hunter2");
    expect(sealed).not.toContain("apiKey");
  });

  it("uses a fresh nonce each time, so identical credentials don't seal identically", () => {
    const secrets = { apiKey: "same" };
    expect(sealSecrets(secrets)).not.toEqual(sealSecrets(secrets));
  });

  it("rejects tampering with any part of the sealed value", () => {
    // Tamper with the *first* character of each segment, not the last. A
    // base64url string's final character can carry padding bits that decoding
    // discards, so flipping it sometimes yields byte-identical plaintext and
    // GCM has nothing to object to — which made the first version of this
    // test pass or fail depending on the random IV.
    const flipFirst = (part: string) => (part[0] === "A" ? "B" : "A") + part.slice(1);

    for (const segment of [1, 2, 3]) {
      const parts = sealSecrets({ apiKey: "abc-123" }).split(".");
      parts[segment] = flipFirst(parts[segment]);
      expect(
        () => openSecrets(parts.join(".")),
        `tampering with segment ${segment} was not detected`
      ).toThrow();
    }
  });

  it("rejects an unversioned or truncated value", () => {
    expect(() => openSecrets("not-sealed")).toThrow(/format/i);
    expect(() => openSecrets("v9.a.b.c")).toThrow(/format/i);
  });

  it("hints at a secret without reproducing it", () => {
    expect(hint("abcdef123456")).toBe("••••••3456");
    expect(hint("abcdef123456")).not.toContain("abcdef");
  });
});
