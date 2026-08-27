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
    `<md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"` +
    ` AuthnRequestsSigned="false" WantAssertionsSigned="true">` +
    `<md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>` +
    `<md:AssertionConsumerService index="0" isDefault="true"` +
    ` Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acs}"/>` +
    `</md:SPSSODescriptor>` +
    `</md:EntityDescriptor>`;
  return { contentType: "application/samlmetadata+xml", body };
}
