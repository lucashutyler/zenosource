import type { DirectoryGroupRecord, DirectoryUser } from "../types";

export const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
export const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SERVICE_PROVIDER_CONFIG_SCHEMA =
  "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";

export const CONTENT_TYPE = "application/scim+json; charset=utf-8";

function splitName(name: string): { givenName: string; familyName: string } {
  const trimmed = name.trim();
  const space = trimmed.lastIndexOf(" ");
  if (space <= 0) return { givenName: trimmed, familyName: "" };
  return { givenName: trimmed.slice(0, space), familyName: trimmed.slice(space + 1) };
}

export function renderUser(user: DirectoryUser): Record<string, unknown> {
  const { givenName, familyName } = splitName(user.name);
  return {
    schemas: [USER_SCHEMA],
    id: user.externalRef,
    externalId: user.externalRef,
    userName: user.email,
    name: { givenName, familyName, formatted: user.name },
    displayName: user.name,
    emails: [{ primary: true, value: user.email, type: "work" }],
    active: user.active,
    meta: { resourceType: "User" },
  };
}

export function renderGroup(
  group: DirectoryGroupRecord,
  members: DirectoryUser[] = []
): Record<string, unknown> {
  return {
    schemas: [GROUP_SCHEMA],
    id: group.externalRef,
    displayName: group.displayName,
    members: members.map((m) => ({ value: m.externalRef, display: m.email })),
    meta: { resourceType: "Group" },
  };
}

export function renderList(
  resources: Record<string, unknown>[],
  options: { startIndex: number; total: number }
): Record<string, unknown> {
  return {
    schemas: [LIST_SCHEMA],
    totalResults: options.total,
    startIndex: options.startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

export function renderError(
  status: number,
  detail: string,
  scimType?: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    schemas: [ERROR_SCHEMA],
    status: String(status),
    detail,
  };
  if (scimType) body.scimType = scimType;
  return body;
}

// A directory believes this: don't advertise support before the endpoint exists.
export function renderServiceProviderConfig(): Record<string, unknown> {
  return {
    schemas: [SERVICE_PROVIDER_CONFIG_SCHEMA],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description: "Authentication using a bearer token issued in ZenoSource.",
        primary: true,
      },
    ],
    meta: { resourceType: "ServiceProviderConfig" },
  };
}

export function renderResourceTypes(): Record<string, unknown>[] {
  return [
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "User",
      name: "User",
      endpoint: "/Users",
      schema: USER_SCHEMA,
      meta: { resourceType: "ResourceType" },
    },
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "Group",
      name: "Group",
      endpoint: "/Groups",
      schema: GROUP_SCHEMA,
      meta: { resourceType: "ResourceType" },
    },
  ];
}
