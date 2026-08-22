// The platform's IdP connector contract, restated structurally.
//
// Same trade as integrations/erp/epicor/src/types.ts: this package imports
// nothing from apps/platform, so the canonical shapes are written out here
// rather than imported, and TypeScript's structural typing is what makes the
// two halves meet. apps/platform/src/lib/integrations/conformance.test.ts is
// what turns drift into a build failure instead of a failed sign-in.
//
// Nothing in this file names Okta, OIDC or SAML. That is the point: the
// vocabulary crossing the boundary is ZenoSource's.

/** An instant, ISO 8601 with an offset. */
export type TimestampString = string;

export type HealthFailureKind =
  | "NONE"
  | "API_KEY"
  | "IDENTITY"
  | "UNREACHABLE"
  | "CONFIGURATION";

export type HealthReport = {
  healthy: boolean;
  failure: HealthFailureKind;
  detail?: string;
  verifiedCapabilities?: string[];
  /**
   * When the credential this connection depends on stops being valid. A
   * signing certificate's notAfter, for an integration that has one.
   * Deliberately does not imply DEGRADED — a certificate with twelve days
   * left is not a broken connection.
   */
  credentialExpiresAt?: TimestampString;
};

export type ConnectorSession = {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

/** Who signed in, in ZenoSource's vocabulary. */
export type FederatedIdentity = {
  /**
   * The directory's own stable key for this person. Never the email — an
   * email address is mutable in a directory, and matching an account on one
   * is the standard account-takeover hole.
   */
  subject: string;
  email: string;
  name?: string | null;
  /**
   * Directory group ids this identity carried, if the protocol supplied any.
   * Advisory only: grants come from groups an OWNER has mapped, never from a
   * claim, so an unmapped group id here grants nothing.
   */
  groupRefs?: string[];
};

/**
 * What the platform asks the connector to check the credential against. All
 * of it is computed from APP_BASE_URL and the tenant's own slug *before*
 * anything untrusted is parsed — that ordering is the security content of
 * "resolve the tenant before validating the assertion."
 */
export type SignInExpectations = {
  callbackUrl: string;
  serviceProviderRef: string;
  expectedRequestId: string;
  expectedNonce?: string | null;
  /** The proof-of-possession value stored when the request was started. */
  codeVerifier?: string | null;
  handle: string;
};

export type SignInRedirect = {
  url: string;
  /** The protocol-level request id the connector minted. */
  requestId: string;
  nonce?: string | null;
  codeVerifier?: string | null;
};

/**
 * The callback, framework-free. Query string and form body are merged by the
 * platform, so no protocol parameter name is written in platform code.
 */
export type SignInCallback = {
  method: "GET" | "POST";
  url: string;
  params: Record<string, string>;
};

export type SignInFailureKind =
  /** Well-formed, and simply did not authenticate this person. Never degrades. */
  | "REJECTED"
  /** Did not verify against anything we trust. Degrades the connection. */
  | "UNTRUSTED"
  /** The tenant's setup is wrong; `detail` names what to change. Degrades. */
  | "MISCONFIGURED"
  /** The identity provider could not be reached at all. Degrades. */
  | "UNREACHABLE";

export type SignInResult =
  | { ok: true; identity: FederatedIdentity }
  | { ok: false; kind: SignInFailureKind; detail: string };

// --- Directory -------------------------------------------------------------

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

/** A write the platform refused, with the sentence explaining why. */
export type DirectoryRefusal = { refused: string };

/**
 * The tenant-scoped port the platform hands down. No method takes a tenant
 * id, so there is no signature into which the wrong tenant can be passed.
 * docs/integrations.md calls a directory credential crossing tenants "a
 * severe multi-tenancy breach"; that boundary is enforced by the shape of
 * this interface rather than delegated to connector good behaviour.
 */
export interface DirectoryStore {
  findUser(externalRef: string): Promise<DirectoryUser | null>;
  findUserByEmail(email: string): Promise<DirectoryUser | null>;
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
  readonly integrationId: string;

  parseConfig(raw: Record<string, unknown>):
    | { ok: true; config: Record<string, unknown>; secrets: Record<string, string> }
    | { ok: false; errors: Record<string, string> };

  checkHealth(session: ConnectorSession): Promise<HealthReport>;

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

/** Injected transport. Every outbound call in this package goes through one. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<Response>;
