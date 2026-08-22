// The identity half of the connector boundary — contract.ts's twin.
//
// Same rule, restated because it is the rule that matters most here: nothing
// below names a vendor, a protocol wire parameter, a directory schema
// identifier or an assertion element. An identity integration is a module that
// satisfies `IdpConnector`, and the platform imports nothing else from it.
//
// It is a sibling file rather than an addition to contract.ts on purpose. That
// file's header says "an integration is a module that satisfies ErpConnector",
// and an ERP and an identity provider have almost nothing in common: one pulls
// batches of records outward, the other completes an authentication and is
// *called* by a directory. Folding them together would produce a union whose
// members are mostly optional, and `connectors.ts`'s assignment — which is the
// conformance check, per its own header — would stop checking anything.
//
// Direction of dependency, deliberately: integrations/idp/okta depends on
// nothing here and restates these shapes structurally in its own src/types.ts.
// conformance.test.ts is what turns drift into a build failure.

import type { ConnectorSession, HealthReport } from "./contract";

/**
 * Who signed in, in ZenoSource's vocabulary.
 */
export type FederatedIdentity = {
  /**
   * The directory's own stable key for this person, scoped to the connection
   * it came from. Never the email: an address is mutable in a directory, and
   * an account matched on a mutable value is an account somebody else can be
   * handed by renaming theirs.
   */
  subject: string;
  email: string;
  name?: string | null;
  /**
   * Group identifiers the credential carried, when the protocol supplied any.
   * Advisory: a grant comes from a group an OWNER has mapped, never from the
   * claim itself, so an unrecognised value here does nothing at all.
   */
  groupRefs?: string[];
};

/**
 * What the connector must check the credential against.
 *
 * Every field is computed from APP_BASE_URL and the tenant's own slug *before*
 * anything untrusted is parsed. That ordering is the security content of
 * docs/integrations.md's "resolve the tenant by email domain or subdomain,
 * then validate the assertion/token against that tenant's stored config": a
 * document must never be allowed to nominate the keys used to trust it.
 */
export type SignInExpectations = {
  /** Where the credential was posted or redirected to. */
  callbackUrl: string;
  /** Our per-tenant identity, as the identity provider knows us. */
  serviceProviderRef: string;
  /** The request id the connector minted, from the consumed request row. */
  expectedRequestId: string;
  expectedNonce?: string | null;
  /** The proof-of-possession value stored when the request was started. */
  codeVerifier?: string | null;
  /** The opaque handle we put in the protocol's round-trip slot. */
  handle: string;
};

export type SignInRedirect = {
  /** Where to send the browser. */
  url: string;
  /** The protocol-level request id, stored on the request row. */
  requestId: string;
  nonce?: string | null;
  codeVerifier?: string | null;
};

/**
 * The callback, framework-free. Query string and form body merged by the
 * platform, so no protocol parameter name is written in platform code.
 */
export type SignInCallback = {
  method: "GET" | "POST";
  url: string;
  params: Record<string, string>;
};

export type SignInFailureKind =
  /**
   * The credential was well-formed and simply did not authenticate this
   * person — expired, cancelled, answered a request that is gone. Never
   * degrades the connection: one person leaving a tab open must not withdraw
   * sign-in for their whole organization.
   */
  | "REJECTED"
  /** Did not verify against anything we trust. Degrades. */
  | "UNTRUSTED"
  /** The tenant's setup is wrong; `detail` names what to change. Degrades. */
  | "MISCONFIGURED"
  /** The identity provider could not be reached at all. Degrades. */
  | "UNREACHABLE";

export type SignInResult =
  | { ok: true; identity: FederatedIdentity }
  | { ok: false; kind: SignInFailureKind; detail: string };

// --- The directory ---------------------------------------------------------
//
// This is the one integration surface that runs inwards: a customer's
// directory calls us. So the platform authenticates the caller, resolves the
// tenant, and hands the connector a store that is already bound to it.

export type DirectoryUser = {
  externalRef: string;
  email: string;
  name: string;
  active: boolean;
};

export type DirectoryGroupRecord = {
  externalRef: string;
  displayName: string;
};

/** A write the platform declined, with the sentence explaining why. */
export type DirectoryRefusal = { refused: string };

/**
 * The tenant-scoped port.
 *
 * No method takes a tenant id, and that is the design rather than an
 * omission. docs/integrations.md: "each tenant's Okta connection gets its own
 * SCIM bearer token, and that token *is* the tenant boundary: a bug that lets
 * one tenant's SCIM token touch another tenant's users is a severe
 * multi-tenancy breach, not just a permissions bug." Isolation by
 * construction — there is no signature into which the wrong tenant can be
 * passed — beats isolation by connector good behaviour, and it is the
 * difference between a bug being impossible and a bug being unlikely.
 */
export interface DirectoryStore {
  findUser(externalRef: string): Promise<DirectoryUser | null>;
  findUserByEmail(email: string): Promise<DirectoryUser | null>;
  /**
   * `skip`/`take`, not the directory protocol's own 1-based paging — that
   * convention is the connector's to translate, along with everything else
   * about the wire format. Zero-based here matches every other query in this
   * codebase, so nobody has to remember which layer they are in.
   */
  listUsers(options: {
    skip: number;
    take: number;
    email?: string;
    externalRef?: string;
  }): Promise<{ users: DirectoryUser[]; total: number }>;
  createUser(user: {
    externalRef: string;
    email: string;
    name: string;
  }): Promise<DirectoryUser | DirectoryRefusal>;
  updateUser(
    externalRef: string,
    patch: { email?: string; name?: string }
  ): Promise<DirectoryUser | DirectoryRefusal>;
  setUserActive(
    externalRef: string,
    active: boolean
  ): Promise<DirectoryUser | DirectoryRefusal>;

  findGroup(externalRef: string): Promise<DirectoryGroupRecord | null>;
  listGroupMembers(externalRef: string): Promise<DirectoryUser[]>;
  listGroups(options: {
    skip: number;
    take: number;
    displayName?: string;
  }): Promise<{ groups: DirectoryGroupRecord[]; total: number }>;
  upsertGroup(group: DirectoryGroupRecord): Promise<DirectoryGroupRecord>;
  deleteGroup(externalRef: string): Promise<void>;
  setGroupMembers(externalRef: string, memberRefs: string[]): Promise<void>;
  addGroupMembers(externalRef: string, memberRefs: string[]): Promise<void>;
  removeGroupMembers(externalRef: string, memberRefs: string[]): Promise<void>;
}

export type DirectoryRequest = {
  method: string;
  /** Path segments after the directory base, e.g. ["Users", "abc"]. */
  segments: string[];
  query: Record<string, string>;
  body: unknown;
};

export type DirectoryResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export interface IdpConnector {
  /** Must match an id in registry.ts. */
  readonly integrationId: string;

  parseConfig(raw: Record<string, unknown>):
    | { ok: true; config: Record<string, unknown>; secrets: Record<string, string> }
    | { ok: false; errors: Record<string, string> };

  checkHealth(session: ConnectorSession): Promise<HealthReport>;

  /**
   * Pull our own opaque handle back out of a callback.
   *
   * It exists so that the platform never has to name the parameter a protocol
   * round-trips it in — the connector knows, and the platform's only interest
   * is the value. Returning it is not a claim that anything has been verified:
   * it is a lookup key, and what it looks up is a single-use row.
   */
  readHandle(callback: SignInCallback): string | null;

  beginSignIn(
    session: ConnectorSession,
    params: {
      callbackUrl: string;
      serviceProviderRef: string;
      handle: string;
      /**
       * The address the person typed on the way in, if they typed one.
       * Advisory: it lets an identity provider skip asking who they are, and
       * it authorizes nothing — whoever comes back is whoever their identity
       * provider says came back, checked the same way regardless.
       */
      loginHint?: string | null;
    }
  ): Promise<SignInRedirect>;

  completeSignIn(
    session: ConnectorSession,
    callback: SignInCallback,
    expectations: SignInExpectations
  ): Promise<SignInResult>;

  /**
   * The document a customer's admin imports at their end. Rendered by the
   * connector so that no protocol element name is ever written here.
   */
  describeServiceProvider(
    session: ConnectorSession,
    params: { callbackUrl: string; serviceProviderRef: string }
  ): Promise<{ contentType: string; body: string }>;

  handleDirectoryRequest(
    session: ConnectorSession,
    request: DirectoryRequest,
    store: DirectoryStore
  ): Promise<DirectoryResponse>;
}

/**
 * What every connector must have regardless of what it integrates with — the
 * two things the connect form and the health check need. `connectors.ts`
 * resolves through this when it genuinely does not care which kind it has.
 */
export type BaseConnector = {
  readonly integrationId: string;
  parseConfig(raw: Record<string, unknown>):
    | { ok: true; config: Record<string, unknown>; secrets: Record<string, string> }
    | { ok: false; errors: Record<string, string> };
  checkHealth(session: ConnectorSession): Promise<HealthReport>;
};
