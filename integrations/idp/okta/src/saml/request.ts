import { deflateRawSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import type { OktaConfig } from "../config";
import type { SignInRedirect } from "../types";

// The sign-in request, built by hand.
//
// Deliberately unsigned. Signing it would mean holding a private key per
// tenant, rotating it, and storing it in a shared multi-tenant database — for
// a document that carries no secret and whose only job is to name where the
// answer should be sent. The answer is what has to be signed, and it is.
//
// The identifier below is what the response must quote back. It is generated
// here, stored by the platform on a single-use row, and compared in guards.ts
// — the three together are what make an unsolicited assertion unusable.

/**
 * A SAML identifier may not begin with a digit, so every generated id is
 * prefixed. Conventional, and one of those rules that produces a baffling
 * parser error at a customer rather than a clear one.
 */
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
    // No NameIDPolicy and no RequestedAuthnContext: both are ways of telling
    // a customer's identity provider how to do its job, and getting either
    // wrong is a rejection an admin cannot diagnose from our side. Their
    // application's own configuration decides.
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

  // The redirect binding carries a raw-deflated, base64'd document in the
  // query string. `deflateRawSync`, not `deflateSync`: the zlib header the
  // latter adds is not part of the binding and identity providers reject it.
  const encoded = deflateRawSync(Buffer.from(xml, "utf8")).toString("base64");

  const url = new URL(config.ssoUrl ?? "");
  url.searchParams.set("SAMLRequest", encoded);
  url.searchParams.set("RelayState", params.handle);

  return { url: url.toString(), requestId };
}
