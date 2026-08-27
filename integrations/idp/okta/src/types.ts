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
  /** Reported, never a reason to degrade: an expiry weeks out is not a broken connection. */
  credentialExpiresAt?: TimestampString;
};

export type ConnectorSession = {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

export type FederatedIdentity = {
  /** The directory's own stable key, never the email: an address is mutable. */
  subject: string;
  email: string;
  name?: string | null;
  /** Advisory: grants come from an OWNER's group mapping, never from a claim. */
  groupRefs?: string[];
};

/** Computed from APP_BASE_URL and the tenant's own slug, never from the callback. */
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
  /** The only kind that does not degrade the connection. */
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

/** Tenant-scoped by construction: no method here may take a tenant id. */
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
