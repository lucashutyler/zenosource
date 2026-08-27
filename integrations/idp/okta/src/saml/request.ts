import { deflateRawSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import type { OktaConfig } from "../config";
import type { SignInRedirect } from "../types";

/** A SAML identifier may not begin with a digit, so every generated id is prefixed. */
export function generateRequestId(): string {
  return `_${randomBytes(20).toString("hex")}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildAuthnRequest(params: {
  requestId: string;
  issuedAt: Date;
  destination: string;
  serviceProviderRef: string;
  callbackUrl: string;
}): string {
  return (
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"` +
    ` xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"` +
    ` ID="${escapeXml(params.requestId)}"` +
    ` Version="2.0"` +
    ` IssueInstant="${params.issuedAt.toISOString()}"` +
    ` Destination="${escapeXml(params.destination)}"` +
    ` ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"` +
    ` AssertionConsumerServiceURL="${escapeXml(params.callbackUrl)}">` +
    `<saml:Issuer>${escapeXml(params.serviceProviderRef)}</saml:Issuer>` +
    `</samlp:AuthnRequest>`
  );
}

export function beginSignIn(
  config: OktaConfig,
  params: { callbackUrl: string; serviceProviderRef: string; handle: string; now?: Date }
): SignInRedirect {
  const requestId = generateRequestId();
  const xml = buildAuthnRequest({
    requestId,
    issuedAt: params.now ?? new Date(),
    destination: config.ssoUrl ?? "",
    serviceProviderRef: params.serviceProviderRef,
    callbackUrl: params.callbackUrl,
  });

  // deflateRawSync: the redirect binding carries no zlib header.
  const encoded = deflateRawSync(Buffer.from(xml, "utf8")).toString("base64");

  const url = new URL(config.ssoUrl ?? "");
  url.searchParams.set("SAMLRequest", encoded);
  url.searchParams.set("RelayState", params.handle);

  return { url: url.toString(), requestId };
}
