import { describe, it, expect } from "vitest";
import { parseConfig } from "./config";

const valid = {
  baseUrl: "https://kinetic.acme.com/Prod",
  company: "EPIC06",
  authMode: "basic",
  apiKey: "key-123",
  username: "svc",
  password: "pw",
};

describe("connect-form parsing", () => {
  it("splits non-secret config from secrets", () => {
    const result = parseConfig(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual({ baseUrl: "https://kinetic.acme.com/Prod", company: "EPIC06", authMode: "basic" });
    expect(result.secrets.apiKey).toBe("key-123");
    // Nothing secret may end up in `config` — that half is stored as
    // plaintext JSON and rendered back on the integrations page.
    expect(JSON.stringify(result.config)).not.toContain("key-123");
    expect(JSON.stringify(result.config)).not.toContain("pw");
  });

  it("tolerates what people actually paste", () => {
    const trailing = parseConfig({ ...valid, baseUrl: "https://kinetic.acme.com/Prod/" });
    expect(trailing.ok && trailing.config.baseUrl).toBe("https://kinetic.acme.com/Prod");

    // Copied out of Epicor's own REST help page, which shows the full path.
    const full = parseConfig({ ...valid, baseUrl: "https://kinetic.acme.com/Prod/api/v2/odata" });
    expect(full.ok && full.config.baseUrl).toBe("https://kinetic.acme.com/Prod");
  });

  it("refuses http:// — a service account can't travel in cleartext", () => {
    const result = parseConfig({ ...valid, baseUrl: "http://kinetic.acme.com/Prod" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.baseUrl).toMatch(/https/i);
  });

  it("requires the API key regardless of auth mode", () => {
    // Kinetic's gateway checks it before authentication runs, so there is no
    // configuration in which it is optional.
    for (const authMode of ["basic", "oauth2"]) {
      const result = parseConfig({ ...valid, authMode, apiKey: "", clientId: "c", clientSecret: "s" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.apiKey).toBeTruthy();
    }
  });

  it("keys errors by the form control's own name, so they render inline", () => {
    const result = parseConfig({ authMode: "basic" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      ["apiKey", "baseUrl", "company", "password", "username"].sort()
    );
  });

  it("asks for client credentials in oauth2 mode and not a password", () => {
    const result = parseConfig({ ...valid, authMode: "oauth2", clientId: "c", clientSecret: "s" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.secrets.clientId).toBe("c");
    expect(result.secrets.password).toBeUndefined();
  });
});
