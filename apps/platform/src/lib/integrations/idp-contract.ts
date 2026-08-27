import type { ConnectorSession, HealthReport } from "./contract";

export type FederatedIdentity = {
  /**
   * The directory's own stable key for this person, scoped to its connection.
   * Never the email: an address is mutable, and an account matched on a
   * mutable value is one somebody else can be handed by a rename.
   */
  subject: string;
  email: string;
  name?: string | null;
  /** Advisory: a grant comes from a group an OWNER mapped, never from the claim. */
  groupRefs?: string[];
};

/**
 * Every field is computed from APP_BASE_URL and the tenant's own slug *before*
 * anything untrusted is parsed: a document must never be allowed to nominate
 * the keys used to trust it.
 */
export type SignInExpectations = {
  callbackUrl: string;
  /** Our per-tenant identity, as the identity provider knows us. */
  serviceProviderRef: string;
  expectedRequestId: string;
  expectedNonce?: string | null;
  codeVerifier?: string | null;
  /** The opaque handle we put in the protocol's round-trip slot. */
  handle: string;
};

export type SignInRedirect = {
  url: string;
  requestId: string;
  nonce?: string | null;
  codeVerifier?: string | null;
};

/** Query string and form body merged, so no protocol parameter name appears in platform code. */
export type SignInCallback = {
  method: "GET" | "POST";
  url: string;
  params: Record<string, string>;
};

export type SignInFailureKind =
  /**
   * Well-formed and simply did not authenticate this person. Never degrades:
   * one person leaving a tab open must not withdraw sign-in for their whole
   * organization.
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
 * Tenant-scoped by construction: no method takes a tenant id, so there is no
 * signature into which the wrong tenant can be passed. A directory token that
 * reached another tenant's users would be a multi-tenancy breach, not a
 * permissions bug.
 */
export interface DirectoryStore {
  findUser(externalRef: string): Promise<DirectoryUser | null>;
  findUserByEmail(email: string): Promise<DirectoryUser | null>;
  /** `skip`/`take`: the directory protocol's own paging convention is the connector's to translate. */
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
   * Pull our own opaque handle back out of a callback. Returning it is not a
   * claim that anything was verified: it is a lookup key for a single-use row.
   */
  readHandle(callback: SignInCallback): string | null;

  beginSignIn(
    session: ConnectorSession,
    params: {
      callbackUrl: string;
      serviceProviderRef: string;
      handle: string;
      /** Advisory: it authorizes nothing, and whoever comes back is checked the same way regardless. */
      loginHint?: string | null;
    }
  ): Promise<SignInRedirect>;

  completeSignIn(
    session: ConnectorSession,
    callback: SignInCallback,
    expectations: SignInExpectations
  ): Promise<SignInResult>;

  /** The document a customer's admin imports at their end. */
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

/** What the connect form and the health check need, for paths that do not care which kind of connector they have. */
export type BaseConnector = {
  readonly integrationId: string;
  parseConfig(raw: Record<string, unknown>):
    | { ok: true; config: Record<string, unknown>; secrets: Record<string, string> }
    | { ok: false; errors: Record<string, string> };
  checkHealth(session: ConnectorSession): Promise<HealthReport>;
};
