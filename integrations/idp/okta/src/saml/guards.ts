import { DOMParser } from "@xmldom/xmldom";
import { normalizeCertificate } from "../metadata";

const PROTOCOL_NS = "urn:oasis:names:tc:SAML:2.0:protocol";
const ASSERTION_NS = "urn:oasis:names:tc:SAML:2.0:assertion";
const DS_NS = "http://www.w3.org/2000/09/xmldsig#";

const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const EXC_C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";

const SIGNATURE_ALGORITHMS = new Set([
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha384",
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512",
]);

const DIGEST_ALGORITHMS = new Set([
  "http://www.w3.org/2001/04/xmlenc#sha256",
  "http://www.w3.org/2001/04/xmldsig-more#sha384",
  "http://www.w3.org/2001/04/xmlenc#sha512",
]);

export const MAX_RESPONSE_BYTES = 1_000_000;

export type GuardFailure = { ok: false; detail: string };
export type GuardOk = { ok: true };
export type GuardResult = GuardOk | GuardFailure;

function fail(detail: string): GuardFailure {
  return { ok: false, detail };
}

export function guardEncodedResponse(
  encoded: string
): { ok: true; xml: string } | GuardFailure {
  if (!encoded) return fail("The sign-in came back without a response.");
  if (encoded.length > MAX_RESPONSE_BYTES * 2) {
    return fail("That sign-in response is too large to be a sign-in response.");
  }
  let xml: string;
  try {
    const buffer = Buffer.from(encoded, "base64");
    if (buffer.length > MAX_RESPONSE_BYTES) {
      return fail("That sign-in response is too large to be a sign-in response.");
    }
    xml = buffer.toString("utf8");
  } catch {
    return fail("That sign-in response is not readable.");
  }
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    return fail("That sign-in response contains a document type declaration, which isn't accepted.");
  }
  return { ok: true, xml };
}

export function parseResponse(xml: string): { ok: true; doc: Document } | GuardFailure {
  let broke: string | null = null;
  let doc: Document;
  try {
    doc = new DOMParser({
      errorHandler: {
        warning: () => {},
        error: (message: string) => {
          broke ??= message;
        },
        fatalError: (message: string) => {
          broke ??= message;
        },
      },
    }).parseFromString(xml, "text/xml") as unknown as Document;
  } catch {
    return fail("That sign-in response is not well-formed XML.");
  }
  if (broke) return fail("That sign-in response is not well-formed XML.");
  return { ok: true, doc };
}

function elements(doc: Document | Element, ns: string, name: string): Element[] {
  const found = doc.getElementsByTagNameNS(ns, name);
  const list: Element[] = [];
  for (let i = 0; i < found.length; i++) list.push(found[i]);
  return list;
}

function allElements(doc: Document): Element[] {
  const found = doc.getElementsByTagName("*");
  const list: Element[] = [];
  for (let i = 0; i < found.length; i++) list.push(found[i]);
  return list;
}

const COMMENT_NODE = 8;

function containsComment(node: Node): boolean {
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === COMMENT_NODE) return true;
    if (child.hasChildNodes() && containsComment(child)) return true;
  }
  return false;
}

export function guardStructure(
  doc: Document,
  options: { trustedCertificates: string[] }
): GuardResult {
  const assertions = elements(doc, ASSERTION_NS, "Assertion");
  if (assertions.length === 0) {
    return fail("That sign-in response carries no assertion.");
  }
  if (assertions.length > 1) {
    // The commonest signature-wrapping shape, and no identity provider sends two.
    return fail("That sign-in response carries more than one assertion.");
  }

  // Canonicalisation drops comments, so one mid-value splits a text node without changing the digest — CVE-2025-29775.
  if (containsComment(assertions[0])) {
    return fail("That sign-in response has a comment inside its assertion.");
  }

  const seenIds = new Set<string>();
  for (const element of allElements(doc)) {
    const id = element.getAttribute("ID");
    if (!id) continue;
    if (seenIds.has(id)) {
      return fail("That sign-in response reuses an element identifier.");
    }
    seenIds.add(id);
  }

  const signatures = elements(doc, DS_NS, "Signature");
  if (signatures.length === 0) {
    return fail("That sign-in response is not signed.");
  }
  if (signatures.length > 2) {
    return fail("That sign-in response carries more signatures than it can use.");
  }

  const trusted = new Set(options.trustedCertificates.map(normalizeCertificate));

  for (const signature of signatures) {
    const parent = signature.parentNode as Element | null;
    if (!parent || parent.nodeType !== 1) {
      return fail("That sign-in response has a signature that covers nothing.");
    }
    const parentId = parent.getAttribute("ID");
    if (!parentId) {
      return fail("That sign-in response has a signature over an element with no identifier.");
    }

    const references = elements(signature, DS_NS, "Reference");
    if (references.length !== 1) {
      return fail("That sign-in response has a signature covering the wrong number of elements.");
    }
    const uri = references[0].getAttribute("URI") ?? "";
    if (uri !== `#${parentId}`) {
      return fail("That sign-in response has a signature that does not cover the element it sits in.");
    }

    const transforms = elements(references[0], DS_NS, "Transform")
      .map((t) => t.getAttribute("Algorithm") ?? "")
      .filter(Boolean);
    if (transforms.length !== 2 || transforms[0] !== ENVELOPED || transforms[1] !== EXC_C14N) {
      return fail("That sign-in response uses a signature transform that isn't accepted.");
    }

    const method = elements(signature, DS_NS, "SignatureMethod")[0]?.getAttribute("Algorithm") ?? "";
    if (!SIGNATURE_ALGORITHMS.has(method)) {
      return fail("That sign-in response is signed with an algorithm that isn't accepted.");
    }
    const digest = elements(references[0], DS_NS, "DigestMethod")[0]?.getAttribute("Algorithm") ?? "";
    if (!DIGEST_ALGORITHMS.has(digest)) {
      return fail("That sign-in response uses a digest algorithm that isn't accepted.");
    }
    const c14n =
      elements(signature, DS_NS, "CanonicalizationMethod")[0]?.getAttribute("Algorithm") ?? "";
    if (c14n !== EXC_C14N) {
      return fail("That sign-in response uses a canonicalisation method that isn't accepted.");
    }

    // The embedded certificate selects which stored one to check, never verifies.
    const embedded = elements(signature, DS_NS, "X509Certificate")
      .map((node) => normalizeCertificate(node.textContent ?? ""))
      .filter(Boolean);
    for (const certificate of embedded) {
      if (!trusted.has(certificate)) {
        return fail(
          "That sign-in response was signed with a certificate this connection doesn't trust. If the certificate was rotated, update it on the integrations page."
        );
      }
    }
  }

  return { ok: true };
}

// `expectedRequestId` is required, not optional: an identity-provider-initiated sign-in is refused.
export function guardBindings(
  doc: Document,
  expectations: {
    callbackUrl: string;
    serviceProviderRef: string;
    expectedRequestId: string;
    idpEntityId?: string;
  }
): GuardResult {
  const response = elements(doc, PROTOCOL_NS, "Response")[0];
  if (!response) return fail("That sign-in response is not a sign-in response.");

  const destination = response.getAttribute("Destination");
  if (destination && destination !== expectations.callbackUrl) {
    return fail("That sign-in response was addressed somewhere else.");
  }

  const inResponseTo = response.getAttribute("InResponseTo") ?? "";
  if (!inResponseTo) {
    return fail(
      "That sign-in response doesn't answer a sign-in request. Start again from the sign-in page rather than from a link."
    );
  }
  if (inResponseTo !== expectations.expectedRequestId) {
    return fail("That sign-in response answers a different sign-in request.");
  }

  if (expectations.idpEntityId) {
    const issuers = elements(doc, ASSERTION_NS, "Issuer").map((node) =>
      (node.textContent ?? "").trim()
    );
    if (issuers.length === 0 || !issuers.every((issuer) => issuer === expectations.idpEntityId)) {
      return fail("That sign-in response came from a different identity provider.");
    }
  }

  const confirmations = elements(doc, ASSERTION_NS, "SubjectConfirmationData");
  if (confirmations.length === 0) {
    return fail("That sign-in response carries no subject confirmation.");
  }
  for (const confirmation of confirmations) {
    const recipient = confirmation.getAttribute("Recipient");
    if (recipient && recipient !== expectations.callbackUrl) {
      return fail("That sign-in response was confirmed for somewhere else.");
    }
    const confirmedInResponseTo = confirmation.getAttribute("InResponseTo");
    if (confirmedInResponseTo && confirmedInResponseTo !== expectations.expectedRequestId) {
      return fail("That sign-in response answers a different sign-in request.");
    }
  }

  const audiences = elements(doc, ASSERTION_NS, "Audience").map((node) =>
    (node.textContent ?? "").trim()
  );
  if (audiences.length === 0) {
    return fail("That sign-in response names no audience.");
  }
  if (!audiences.includes(expectations.serviceProviderRef)) {
    return fail("That sign-in response was issued for a different organization.");
  }

  return { ok: true };
}
