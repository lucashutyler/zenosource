import { SAML, SamlStatusError } from "@node-saml/node-saml";
import { guardBindings, guardEncodedResponse, guardStructure, parseResponse } from "./guards";
import type { OktaConfig } from "../config";
import type {
  FederatedIdentity,
  SignInCallback,
  SignInExpectations,
  SignInResult,
} from "../types";

export const CLOCK_SKEW_MS = 60_000;

export const MAX_ASSERTION_AGE_MS = 10 * 60_000;

type Profile = {
  nameID?: string;
  inResponseTo?: string;
  issuer?: string;
  sessionIndex?: string;
  attributes?: Record<string, unknown>;
  [claim: string]: unknown;
};

function claim(profile: Profile, ...names: string[]): string | null {
  const attributes = (profile.attributes ?? {}) as Record<string, unknown>;
  for (const name of names) {
    for (const source of [attributes, profile as Record<string, unknown>]) {
      const value = source[name];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (Array.isArray(value)) {
        const first = value.find((v) => typeof v === "string" && v.trim());
        if (typeof first === "string") return first.trim();
      }
    }
  }
  return null;
}

function groupsFrom(profile: Profile): string[] {
  const attributes = (profile.attributes ?? {}) as Record<string, unknown>;
  for (const name of ["groups", "Groups", "memberOf"]) {
    const value = attributes[name];
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
    if (typeof value === "string" && value.trim()) return [value.trim()];
  }
  return [];
}

export async function completeSignIn(
  config: OktaConfig,
  callback: SignInCallback,
  expectations: SignInExpectations
): Promise<SignInResult> {
  const encoded = callback.params.SAMLResponse ?? "";
  const decoded = guardEncodedResponse(encoded);
  if (!decoded.ok) return { ok: false, kind: "REJECTED", detail: decoded.detail };

  const parsed = parseResponse(decoded.xml);
  if (!parsed.ok) return { ok: false, kind: "REJECTED", detail: parsed.detail };

  const certificates = config.certificates ?? [];
  if (certificates.length === 0) {
    return {
      ok: false,
      kind: "MISCONFIGURED",
      detail: "This connection has no signing certificate stored, so no sign-in can be verified.",
    };
  }

  const structure = guardStructure(parsed.doc, { trustedCertificates: certificates });
  if (!structure.ok) return { ok: false, kind: "UNTRUSTED", detail: structure.detail };

  const bindings = guardBindings(parsed.doc, {
    callbackUrl: expectations.callbackUrl,
    serviceProviderRef: expectations.serviceProviderRef,
    expectedRequestId: expectations.expectedRequestId,
    idpEntityId: config.idpEntityId,
  });
  if (!bindings.ok) return { ok: false, kind: "UNTRUSTED", detail: bindings.detail };

  const saml = new SAML({
    idpCert: certificates,
    issuer: expectations.serviceProviderRef,
    callbackUrl: expectations.callbackUrl,
    audience: expectations.serviceProviderRef,
    idpIssuer: config.idpEntityId,
    // Requiring a response signature the customer's IdP was never asked to add rejects every sign-in.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: config.responseSigned === true,
    // The library's in-flight cache is per-process and rejects valid responses on a second instance; guardBindings checks InResponseTo.
    validateInResponseTo: "never" as never,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    maxAssertionAgeMs: MAX_ASSERTION_AGE_MS,
    signatureAlgorithm: "sha256",
    digestAlgorithm: "sha256",
    wantAssertionsEncrypted: false,
    privateKey: undefined,
  } as ConstructorParameters<typeof SAML>[0]);

  let profile: Profile;
  try {
    const validated = await saml.validatePostResponseAsync({ SAMLResponse: encoded });
    profile = (validated.profile ?? {}) as Profile;
  } catch (thrown) {
    if (thrown instanceof SamlStatusError) {
      return { ok: false, kind: "REJECTED", detail: thrown.message };
    }
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    const stale = /expired|clock|NotOnOrAfter|too much/i.test(message);
    return {
      ok: false,
      kind: stale ? "REJECTED" : "UNTRUSTED",
      detail: stale ? "That sign-in took too long to come back. Try again." : message,
    };
  }

  // Re-checked against the library's verified profile: the guards read the document, not what was verified.
  if ((profile.inResponseTo ?? "") !== expectations.expectedRequestId) {
    return {
      ok: false,
      kind: "UNTRUSTED",
      detail: "That sign-in response answers a different sign-in request.",
    };
  }

  const email = (
    claim(
      profile,
      "email",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      "nameID"
    ) ?? ""
  )
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) {
    return {
      ok: false,
      kind: "MISCONFIGURED",
      detail:
        "That sign-in carried no email address. Set the application's name ID to the user's email, or add an `email` attribute statement.",
    };
  }

  // Matched on the directory's key, never the email: an address is mutable.
  const subject =
    claim(profile, "http://schemas.microsoft.com/identity/claims/objectidentifier", "externalId") ??
    profile.nameID ??
    email;

  const identity: FederatedIdentity = {
    subject,
    email,
    name: claim(profile, "displayName", "name", "firstName") ?? null,
  };
  const groups = groupsFrom(profile);
  if (groups.length > 0) identity.groupRefs = groups;

  return { ok: true, identity };
}
