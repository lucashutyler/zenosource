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

/** How old an assertion may be regardless of its own stated window. */
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
    // The response signature follows the customer's own setting: requiring one
    // their identity provider was never asked to add rejects every valid sign-in.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: config.responseSigned === true,
    // Ours to enforce, not the library's: its in-flight cache is per-process, so on
    // more than one instance it rejects valid responses. guardBindings checks it.
    validateInResponseTo: "never" as never,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    maxAssertionAgeMs: MAX_ASSERTION_AGE_MS,
    signatureAlgorithm: "sha256",
    digestAlgorithm: "sha256",
    wantAssertionsEncrypted: false,
    // Named so that a change that starts signing has to add a key deliberately.
    privateKey: undefined,
  } as ConstructorParameters<typeof SAML>[0]);

  let profile: Profile;
  try {
    const validated = await saml.validatePostResponseAsync({ SAMLResponse: encoded });
    profile = (validated.profile ?? {}) as Profile;
  } catch (thrown) {
    if (thrown instanceof SamlStatusError) {
      // The identity provider itself declined; nothing about this connection is broken.
      return { ok: false, kind: "REJECTED", detail: thrown.message };
    }
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    // A clock-window failure is this attempt, not the connection's trust.
    const stale = /expired|clock|NotOnOrAfter|too much/i.test(message);
    return {
      ok: false,
      kind: stale ? "REJECTED" : "UNTRUSTED",
      detail: stale ? "That sign-in took too long to come back. Try again." : message,
    };
  }

  // Re-asserted against the profile the library built from the assertion it
  // verified, so a guard-passing document with a profile from elsewhere cannot pass.
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

  // Never the email: a directory can change someone's address, and an account
  // matched on a mutable value is an account someone else can be handed.
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
