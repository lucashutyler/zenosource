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
   * When the credential this connection depends on stops being valid. Does
   * not imply DEGRADED — a certificate with twelve days left is not a broken
   * connection.
   */
  credentialExpiresAt?: TimestampString;
};

export type ConnectorSession = {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

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
 * anything untrusted is parsed.
 */
export type SignInExpectations = {
  callbackUrl: string;
  serviceProviderRef: string;
  expectedRequestId: string;
  expectedNonce?: string | null;
  codeVerifier?: string | null;
  handle: string;
};

export type SignInRedirect = {
  url: string;
  requestId: string;
  nonce?: string | null;
  codeVerifier?: string | null;
};

/** Query string and form body are merged by the platform into `params`. */
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

export type DirectoryRefusal = { refused: string };

/**
 * Tenant-scoped by construction: no method takes a tenant id, so there is no
 * signature into which the wrong tenant can be passed.
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
       * Advisory only: it lets an identity provider skip asking who they are,
       * and it authorizes nothing — whoever comes back is checked the same
       * way regardless.
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

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<Response>;
