import { parseFilter, parsePaging } from "./filter";
import { parseGroup, parseUser } from "./parse";
import { parseGroupPatch, parseUserPatch } from "./patch";
import {
  CONTENT_TYPE,
  renderError,
  renderGroup,
  renderList,
  renderResourceTypes,
  renderServiceProviderConfig,
  renderUser,
  GROUP_SCHEMA,
  USER_SCHEMA,
} from "./render";
import type {
  DirectoryRefusal,
  DirectoryRequest,
  DirectoryResponse,
  DirectoryStore,
  DirectoryUser,
} from "../types";

// No signature in this file accepts a tenant id: the store handed down is
// already bound to one, and that is the whole defence against a cross-tenant write.

function refused(result: unknown): result is DirectoryRefusal {
  return Boolean(result && typeof result === "object" && "refused" in (result as object));
}

function json(status: number, body: unknown): DirectoryResponse {
  return { status, headers: { "content-type": CONTENT_TYPE }, body };
}

function error(status: number, detail: string, scimType?: string): DirectoryResponse {
  return json(status, renderError(status, detail, scimType));
}

const NOT_FOUND = "No such resource.";

export async function handleDirectoryRequest(
  request: DirectoryRequest,
  store: DirectoryStore
): Promise<DirectoryResponse> {
  const method = request.method.toUpperCase();
  const [resource, id, ...rest] = request.segments;
  if (rest.length > 0) return error(404, NOT_FOUND);

  switch ((resource ?? "").toLowerCase()) {
    case "serviceproviderconfig":
      if (method !== "GET") return error(405, "Method not allowed.");
      return json(200, renderServiceProviderConfig());

    case "resourcetypes":
      if (method !== "GET") return error(405, "Method not allowed.");
      return json(200, renderList(renderResourceTypes(), { startIndex: 1, total: 2 }));

    case "schemas":
      if (method !== "GET") return error(405, "Method not allowed.");
      return json(
        200,
        renderList(
          [
            { id: USER_SCHEMA, name: "User", meta: { resourceType: "Schema" } },
            { id: GROUP_SCHEMA, name: "Group", meta: { resourceType: "Schema" } },
          ],
          { startIndex: 1, total: 2 }
        )
      );

    case "users":
      return handleUsers(method, id, request, store);

    case "groups":
      return handleGroups(method, id, request, store);

    default:
      return error(404, NOT_FOUND);
  }
}

async function handleUsers(
  method: string,
  id: string | undefined,
  request: DirectoryRequest,
  store: DirectoryStore
): Promise<DirectoryResponse> {
  if (!id) {
    if (method === "GET") {
      const filter = parseFilter(request.query.filter);
      if (!filter.ok) return error(400, filter.detail, "invalidFilter");
      const { startIndex, count } = parsePaging(request.query);

      // The protocol pages from 1; the platform's port pages from 0.
      const options: { skip: number; take: number; email?: string; externalRef?: string } = {
        skip: startIndex - 1,
        take: count,
      };
      if (filter.attribute === "username") options.email = filter.value!.toLowerCase();
      if (filter.attribute === "externalid" || filter.attribute === "id") {
        options.externalRef = filter.value!;
      }
      if (filter.attribute === "displayname") {
        return error(400, "Filtering users on displayName is not supported.", "invalidFilter");
      }

      const { users, total } = await store.listUsers(options);
      return json(200, renderList(users.map(renderUser), { startIndex, total }));
    }

    if (method === "POST") {
      const parsed = parseUser(request.body);
      if (!parsed.ok) return error(400, parsed.detail, "invalidValue");
      const { externalRef, email, name, active } = parsed.value;
      if (!externalRef) {
        return error(400, "The user carries no directory identifier.", "invalidValue");
      }

      const existing =
        (await store.findUser(externalRef)) ?? (await store.findUserByEmail(email));
      if (existing) {
        // Not a conflict: a retried create, or a person who already had a
        // password account here. A 409 would stall the whole import.
        const adopted = await store.createUser({ externalRef, email, name });
        if (refused(adopted)) return error(409, adopted.refused, "uniqueness");
        if (!active) {
          const deactivated = await store.setUserActive(externalRef, false);
          if (refused(deactivated)) return error(409, deactivated.refused);
          return json(201, renderUser(deactivated));
        }
        return json(201, renderUser(adopted));
      }

      const created = await store.createUser({ externalRef, email, name });
      if (refused(created)) return error(409, created.refused, "uniqueness");
      if (!active) {
        const deactivated = await store.setUserActive(externalRef, false);
        if (refused(deactivated)) return error(409, deactivated.refused);
        return json(201, renderUser(deactivated));
      }
      return json(201, renderUser(created));
    }

    return error(405, "Method not allowed.");
  }

  const user = await store.findUser(id);

  if (method === "GET") {
    if (!user) return error(404, NOT_FOUND);
    return json(200, renderUser(user));
  }

  if (method === "DELETE") {
    if (!user) return error(404, NOT_FOUND);
    // Deactivate, never delete: every order, action item and status event this
    // person owns points at their row.
    const result = await store.setUserActive(id, false);
    if (refused(result)) return error(409, result.refused);
    return { status: 204, headers: {}, body: null };
  }

  if (method === "PUT") {
    if (!user) return error(404, NOT_FOUND);
    const parsed = parseUser(request.body);
    if (!parsed.ok) return error(400, parsed.detail, "invalidValue");
    const updated = await store.updateUser(id, {
      email: parsed.value.email,
      name: parsed.value.name,
    });
    if (refused(updated)) return error(409, updated.refused, "uniqueness");
    if (parsed.value.active !== updated.active) {
      const toggled = await store.setUserActive(id, parsed.value.active);
      if (refused(toggled)) return error(409, toggled.refused);
      return json(200, renderUser(toggled));
    }
    return json(200, renderUser(updated));
  }

  if (method === "PATCH") {
    if (!user) return error(404, NOT_FOUND);
    const parsed = parseUserPatch(request.body);
    // A patch shape we cannot read is a 400 and never a 200: a directory records
    // a 200 as done and stops retrying the deactivation.
    if (!parsed.ok) return error(400, parsed.detail, "invalidValue");

    let current: DirectoryUser = user;
    if (parsed.value.email !== undefined || parsed.value.name !== undefined) {
      const patch: { email?: string; name?: string } = {};
      if (parsed.value.email !== undefined) patch.email = parsed.value.email;
      if (parsed.value.name !== undefined) patch.name = parsed.value.name;
      const updated = await store.updateUser(id, patch);
      if (refused(updated)) return error(409, updated.refused, "uniqueness");
      current = updated;
    }
    if (parsed.value.active !== undefined && parsed.value.active !== current.active) {
      const toggled = await store.setUserActive(id, parsed.value.active);
      if (refused(toggled)) return error(409, toggled.refused);
      current = toggled;
    }
    return json(200, renderUser(current));
  }

  return error(405, "Method not allowed.");
}

async function handleGroups(
  method: string,
  id: string | undefined,
  request: DirectoryRequest,
  store: DirectoryStore
): Promise<DirectoryResponse> {
  if (!id) {
    if (method === "GET") {
      const filter = parseFilter(request.query.filter);
      if (!filter.ok) return error(400, filter.detail, "invalidFilter");
      const { startIndex, count } = parsePaging(request.query);
      const options: { skip: number; take: number; displayName?: string } = {
        skip: startIndex - 1,
        take: count,
      };
      if (filter.attribute === "displayname") options.displayName = filter.value!;
      const { groups, total } = await store.listGroups(options);
      return json(
        200,
        renderList(
          groups.map((group) => renderGroup(group)),
          { startIndex, total }
        )
      );
    }

    if (method === "POST") {
      const parsed = parseGroup(request.body);
      if (!parsed.ok) return error(400, parsed.detail, "invalidValue");
      if (!parsed.value.externalRef) {
        return error(400, "The group carries no directory identifier.", "invalidValue");
      }
      const group = await store.upsertGroup({
        externalRef: parsed.value.externalRef,
        displayName: parsed.value.displayName,
      });
      if (parsed.value.memberRefs.length > 0) {
        await store.setGroupMembers(group.externalRef, parsed.value.memberRefs);
      }
      return json(201, renderGroup(group, await store.listGroupMembers(group.externalRef)));
    }

    return error(405, "Method not allowed.");
  }

  const group = await store.findGroup(id);

  if (method === "GET") {
    if (!group) return error(404, NOT_FOUND);
    return json(200, renderGroup(group, await store.listGroupMembers(id)));
  }

  if (method === "DELETE") {
    if (!group) return error(404, NOT_FOUND);
    // The group goes; the people do not. A grant an owner made by hand outranks
    // a directory one and survives this.
    await store.deleteGroup(id);
    return { status: 204, headers: {}, body: null };
  }

  if (method === "PUT") {
    if (!group) return error(404, NOT_FOUND);
    const parsed = parseGroup(request.body);
    if (!parsed.ok) return error(400, parsed.detail, "invalidValue");
    const updated = await store.upsertGroup({
      externalRef: id,
      displayName: parsed.value.displayName,
    });
    await store.setGroupMembers(id, parsed.value.memberRefs);
    return json(200, renderGroup(updated, await store.listGroupMembers(id)));
  }

  if (method === "PATCH") {
    if (!group) return error(404, NOT_FOUND);
    const parsed = parseGroupPatch(request.body);
    if (!parsed.ok) return error(400, parsed.detail, "invalidValue");

    let current = group;
    if (parsed.value.displayName !== undefined) {
      current = await store.upsertGroup({
        externalRef: id,
        displayName: parsed.value.displayName,
      });
    }
    if (parsed.value.replace !== undefined) {
      await store.setGroupMembers(id, parsed.value.replace);
    }
    if (parsed.value.add.length > 0) await store.addGroupMembers(id, parsed.value.add);
    if (parsed.value.remove.length > 0) await store.removeGroupMembers(id, parsed.value.remove);

    return json(200, renderGroup(current, await store.listGroupMembers(id)));
  }

  return error(405, "Method not allowed.");
}
