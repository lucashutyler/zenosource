import { describe, it, expect } from "vitest";
import { safeReturnTo } from "./return-to";

// An open redirect through a sign-in flow is the classic phishing primitive:
// the link is real, the sign-in is real, and the landing page is not. The
// main defence is structural — nothing an identity provider sends is ever
// treated as a URL — and this is the other end of it.

describe("safeReturnTo", () => {
  it("keeps an ordinary in-app path", () => {
    expect(safeReturnTo("/dashboard/purchase-orders")).toBe("/dashboard/purchase-orders");
    expect(safeReturnTo("/dashboard/rfqs?status=SENT")).toBe("/dashboard/rfqs?status=SENT");
  });

  it("refuses an absolute URL", () => {
    expect(safeReturnTo("https://evil.test/collect")).toBe("/dashboard");
    expect(safeReturnTo("http://evil.test")).toBe("/dashboard");
  });

  it("refuses a protocol-relative URL in both spellings a browser accepts", () => {
    expect(safeReturnTo("//evil.test")).toBe("/dashboard");
    expect(safeReturnTo("/\\evil.test")).toBe("/dashboard");
  });

  it("refuses a scheme smuggled into the first segment", () => {
    expect(safeReturnTo("/javascript:alert(1)")).toBe("/dashboard");
    expect(safeReturnTo("/data:text/html,x")).toBe("/dashboard");
  });

  it("refuses control characters, which are how a header gets split", () => {
    expect(safeReturnTo("/dashboard\r\nSet-Cookie: session=x")).toBe("/dashboard");
    expect(safeReturnTo("/dashboard\nLocation: https://evil.test")).toBe("/dashboard");
  });

  it("refuses a loop back into the sign-in machinery", () => {
    // Landing on the login page after signing in reads as "sign-in is broken"
    // rather than "that link was odd".
    expect(safeReturnTo("/login")).toBe("/dashboard");
    expect(safeReturnTo("/login/sso")).toBe("/dashboard");
    expect(safeReturnTo("/api/sso/acme/start")).toBe("/dashboard");
  });

  it("falls back for nothing at all", () => {
    expect(safeReturnTo(null)).toBe("/dashboard");
    expect(safeReturnTo(undefined)).toBe("/dashboard");
    expect(safeReturnTo("")).toBe("/dashboard");
    expect(safeReturnTo("   ")).toBe("/dashboard");
  });
});
