// The document a customer's identity-provider admin imports at their end.
//
// Rendered here rather than in the platform for one reason: no element name
// belonging to a federation protocol may be written in apps/platform/src.
// That rule is what keeps a second identity provider a config addition, and
// it does not have an exception for "it's only a template".

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderServiceProviderMetadata(params: {
  serviceProviderRef: string;
  callbackUrl: string;
}): { contentType: string; body: string } {
  const entityId = escapeXml(params.serviceProviderRef);
  const acs = escapeXml(params.callbackUrl);
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">` +
    // No signing or encryption key is published, because this service
    // provider signs nothing and decrypts nothing — see saml/request.ts for
    // why requests are unsigned, and the phase's own notes for why encrypted
    // assertions are refused by name rather than half-supported.
    `<md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"` +
    ` AuthnRequestsSigned="false" WantAssertionsSigned="true">` +
    `<md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>` +
    `<md:AssertionConsumerService index="0" isDefault="true"` +
    ` Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acs}"/>` +
    `</md:SPSSODescriptor>` +
    `</md:EntityDescriptor>`;
  return { contentType: "application/samlmetadata+xml", body };
}
