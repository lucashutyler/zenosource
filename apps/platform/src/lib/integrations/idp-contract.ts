import type { ConnectorSession, HealthReport } from "./contract";

export type FederatedIdentity = {
  /** The directory's own stable key, never the email: an address is mutable. */
  subject: string;
  email: string;
  name?: string | null;
  /** Advisory: a grant comes from a group an OWNER mapped, never from the claim. */
  groupRefs?: string[];
};

/** Computed before anything untrusted is parsed: a document must never nominate what checks it. */
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

export type SignInCallback = {
  method: "GET" | "POST";
  url: string;
  params: Record<string, string>;
};

export type SignInFailureKind =
  /** Never degrades: one person's stale tab must not withdraw sign-in for the whole tenant. */
  | "REJECTED"
  | "UNTRUSTED"
  | "MISCONFIGURED"
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

/** Tenant-scoped by construction: no method takes a tenant id that could be the wrong one. */
export interface DirectoryStore {
  findUser(externalRef: string): Promise<DirectoryUser | null>;
  findUserByEmail(email: string): Promise<DirectoryUser | null>;
  /** The protocol's own paging convention is the connector's to translate, never this port's. */
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

  /** Returning a handle is not a claim that anything was verified. */
  readHandle(callback: SignInCallback): string | null;

  beginSignIn(
    session: ConnectorSession,
    params: {
      callbackUrl: string;
      serviceProviderRef: string;
      handle: string;
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

export type BaseConnector = {
  readonly integrationId: string;
  parseConfig(raw: Record<string, unknown>):
    | { ok: true; config: Record<string, unknown>; secrets: Record<string, string> }
    | { ok: false; errors: Record<string, string> };
  checkHealth(session: ConnectorSession): Promise<HealthReport>;
};
