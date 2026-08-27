import { DOMParser } from "@xmldom/xmldom";

const MD_NS = "urn:oasis:names:tc:SAML:2.0:metadata";
const DS_NS = "http://www.w3.org/2000/09/xmldsig#";
const REDIRECT_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
const POST_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";

const MAX_BYTES = 1_000_000;

export type IdpMetadata = {
  entityId: string;
  /** Where the browser is sent to start a sign-in. Redirect binding preferred. */
  ssoUrl: string;
  /**
   * Signing certificates, base64 DER, in document order. A list because a
   * rollover publishes the next certificate beside the current one.
   */
  certificates: string[];
};

export type MetadataResult =
  | { ok: true; metadata: IdpMetadata }
  | { ok: false; error: string };

/** Strips PEM armour and every kind of whitespace. */
export function normalizeCertificate(raw: string): string {
  return raw
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

export function parseIdpMetadata(xml: string): MetadataResult {
  if (!xml.trim()) return { ok: false, error: "Empty document." };
  if (Buffer.byteLength(xml, "utf8") > MAX_BYTES) {
    return { ok: false, error: "That document is too large to be identity-provider metadata." };
  }
  // Accepting a DOCTYPE is how entity expansion gets in.
  if (/<!DOCTYPE/i.test(xml)) {
    return { ok: false, error: "That document contains a DOCTYPE declaration, which isn't accepted." };
  }

  let doc: Document;
  try {
    let failure: string | null = null;
    doc = new DOMParser({
      errorHandler: {
        warning: () => {},
        error: (message: string) => {
          failure ??= message;
        },
        fatalError: (message: string) => {
          failure ??= message;
        },
      },
    }).parseFromString(xml, "text/xml") as unknown as Document;
    if (failure) return { ok: false, error: "That isn't well-formed XML." };
  } catch {
    return { ok: false, error: "That isn't well-formed XML." };
  }

  const descriptors = doc.getElementsByTagNameNS(MD_NS, "IDPSSODescriptor");
  const descriptor = descriptors.length > 0 ? descriptors[0] : null;
  if (!descriptor) {
    return {
      ok: false,
      error:
        "That looks like XML, but not like identity-provider metadata — it has no identity-provider section.",
    };
  }

  const entityDescriptors = doc.getElementsByTagNameNS(MD_NS, "EntityDescriptor");
  const entityId = entityDescriptors.length
    ? entityDescriptors[0].getAttribute("entityID")?.trim()
    : null;
  if (!entityId) return { ok: false, error: "The metadata has no entity ID." };

  const services = descriptor.getElementsByTagNameNS(MD_NS, "SingleSignOnService");
  let redirect: string | null = null;
  let post: string | null = null;
  for (let i = 0; i < services.length; i++) {
    const binding = services[i].getAttribute("Binding");
    const location = services[i].getAttribute("Location")?.trim() ?? "";
    if (!location) continue;
    if (binding === REDIRECT_BINDING) redirect ??= location;
    if (binding === POST_BINDING) post ??= location;
  }
  // Redirect first: this package builds a redirect-binding request.
  const ssoUrl = redirect ?? post;
  if (!ssoUrl) return { ok: false, error: "The metadata has no sign-in URL." };
  if (!ssoUrl.startsWith("https://") && !ssoUrl.startsWith("http://localhost")) {
    return { ok: false, error: "The sign-in URL must be https://." };
  }

  const certificates: string[] = [];
  const keyDescriptors = descriptor.getElementsByTagNameNS(MD_NS, "KeyDescriptor");
  for (let i = 0; i < keyDescriptors.length; i++) {
    const use = keyDescriptors[i].getAttribute("use");
    // Absent `use` means the key serves every purpose, which includes signing.
    if (use && use !== "signing") continue;
    const certs = keyDescriptors[i].getElementsByTagNameNS(DS_NS, "X509Certificate");
    for (let j = 0; j < certs.length; j++) {
      const value = normalizeCertificate(certs[j].textContent ?? "");
      if (value && !certificates.includes(value)) certificates.push(value);
    }
  }
  if (certificates.length === 0) {
    return { ok: false, error: "The metadata has no signing certificate." };
  }

  return { ok: true, metadata: { entityId, ssoUrl, certificates } };
}
