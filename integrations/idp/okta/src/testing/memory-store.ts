import type {
  DirectoryGroupRecord,
  DirectoryRefusal,
  DirectoryStore,
  DirectoryUser,
} from "../types";

export type MemoryStoreOptions = {
  /** Emails this store refuses to deactivate, standing in for a last owner. */
  undeactivatable?: string[];
};

export function createMemoryStore(
  seed: DirectoryUser[] = [],
  options: MemoryStoreOptions = {}
): DirectoryStore & { users: Map<string, DirectoryUser>; groups: Map<string, DirectoryGroupRecord> } {
  const users = new Map<string, DirectoryUser>(seed.map((u) => [u.externalRef, { ...u }]));
  const groups = new Map<string, DirectoryGroupRecord>();
  const members = new Map<string, Set<string>>();
  const undeactivatable = new Set(options.undeactivatable ?? []);

  const refusal = (message: string): DirectoryRefusal => ({ refused: message });

  return {
    users,
    groups,

    async findUser(externalRef) {
      return users.get(externalRef) ?? null;
    },
    async findUserByEmail(email) {
      for (const user of users.values()) {
        if (user.email.toLowerCase() === email.toLowerCase()) return user;
      }
      return null;
    },
    async listUsers({ skip, take, email, externalRef }) {
      let all = [...users.values()];
      if (email) all = all.filter((u) => u.email.toLowerCase() === email.toLowerCase());
      if (externalRef) all = all.filter((u) => u.externalRef === externalRef);
      return { users: all.slice(skip, skip + take), total: all.length };
    },
    async createUser({ externalRef, email, name }) {
      const clash = [...users.values()].find(
        (u) => u.email.toLowerCase() === email.toLowerCase() && u.externalRef !== externalRef
      );
      if (clash) {
        // Adoption, not conflict: the same person under a password account is
        // the normal case at a first federation.
        users.delete(clash.externalRef);
      }
      const existing = users.get(externalRef);
      const user: DirectoryUser = {
        externalRef,
        email,
        name,
        active: existing?.active ?? clash?.active ?? true,
      };
      users.set(externalRef, user);
      return user;
    },
    async updateUser(externalRef, patch) {
      const user = users.get(externalRef);
      if (!user) return refusal("No such user.");
      if (patch.email) {
        const clash = [...users.values()].find(
          (u) => u.externalRef !== externalRef && u.email.toLowerCase() === patch.email!.toLowerCase()
        );
        if (clash) return refusal("Another user already has that address.");
        user.email = patch.email;
      }
      if (patch.name) user.name = patch.name;
      return user;
    },
    async setUserActive(externalRef, active) {
      const user = users.get(externalRef);
      if (!user) return refusal("No such user.");
      if (!active && undeactivatable.has(user.email)) {
        return refusal("That is the last owner of this organization.");
      }
      user.active = active;
      return user;
    },

    async findGroup(externalRef) {
      return groups.get(externalRef) ?? null;
    },
    async listGroupMembers(externalRef) {
      const refs = members.get(externalRef) ?? new Set<string>();
      return [...refs].map((ref) => users.get(ref)).filter((u): u is DirectoryUser => Boolean(u));
    },
    async listGroups({ skip, take, displayName }) {
      let all = [...groups.values()];
      if (displayName) all = all.filter((g) => g.displayName === displayName);
      return { groups: all.slice(skip, skip + take), total: all.length };
    },
    async upsertGroup(group) {
      groups.set(group.externalRef, { ...group });
      if (!members.has(group.externalRef)) members.set(group.externalRef, new Set());
      return groups.get(group.externalRef)!;
    },
    async deleteGroup(externalRef) {
      groups.delete(externalRef);
      members.delete(externalRef);
    },
    async setGroupMembers(externalRef, memberRefs) {
      members.set(externalRef, new Set(memberRefs));
    },
    async addGroupMembers(externalRef, memberRefs) {
      const set = members.get(externalRef) ?? new Set<string>();
      for (const ref of memberRefs) set.add(ref);
      members.set(externalRef, set);
    },
    async removeGroupMembers(externalRef, memberRefs) {
      const set = members.get(externalRef) ?? new Set<string>();
      for (const ref of memberRefs) set.delete(ref);
      members.set(externalRef, set);
    },
  };
}
