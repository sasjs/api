/**
 * The directory import: what a host's LDAP answer means for its records.
 *
 * `POST /SASjsApi/authConfig/synchroniseWithLDAP` asks a host to pull its
 * directory into the accounts the API knows. The directory connection is the
 * host's - an LDAP client, a bind, a set of base DNs - and this file cannot
 * have one. What it owns is the import:
 *
 *   - a user or group that already exists is left untouched, matched by the
 *     name the API keys on (`username`, group `name`), which is what the
 *     document states and what makes the call repeatable: a second run imports
 *     nothing rather than duplicating the directory;
 *   - what it creates is marked with the provider (`ldap` by default), so a
 *     host can tell a directory-managed account from a local one - including
 *     the groups, which is why `NewGroup` carries the field;
 *   - membership travels both ways in a directory answer (a group lists its
 *     members, and a user lists its groups), so both are read and the union is
 *     applied to the groups this call created. An existing group is not
 *     touched: importing is not reconciling, and a caller who expects a
 *     deprovisioning sync has asked for a different operation;
 *   - a directory answer that names the same username twice, or a user with no
 *     username, is refused rather than half-imported.
 *
 * sasjs/server's own implementation deletes every provider-managed account and
 * re-imports; that is its store's policy and it is deliberately not generalised
 * here. The document's description - "Users and groups that already exist are
 * left untouched" - is what this service implements.
 */
import type {
  IdentityGroupRecord,
  IdentityStore,
  IdentityUserRecord
} from '../identity/types.js'

export interface DirectoryUser {
  username: string
  displayName: string
  /** Groups the directory says this user belongs to, by group name. */
  groups?: string[]
}

export interface DirectoryGroup {
  name: string
  /** Members the directory says this group holds, by username. */
  members?: string[]
}

/** One look at the directory, as the host read it. */
export interface DirectorySource {
  users(): Promise<DirectoryUser[]>
  groups(): Promise<DirectoryGroup[]>
}

export interface DirectorySyncResult {
  /** How many accounts this call created; existing ones are not counted. */
  userCount: number
  /** How many groups this call created. */
  groupCount: number
}

export interface DirectoryService {
  synchronise(): Promise<DirectorySyncResult>
}

export interface DirectoryServiceOptions {
  /**
   * The `authProvider` stamped on what the import creates. `ldap` is the
   * provider this route names; a host with a second directory can state its own.
   */
  provider?: string
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

/**
 * The users, checked before anything is written.
 *
 * A duplicate or nameless entry is refused before the first write, so a bad
 * directory answer cannot leave the store half-imported.
 */
const usersOf = (users: DirectoryUser[]): DirectoryUser[] => {
  if (!Array.isArray(users))
    throw new Error('The directory answer has no users array.')

  const seen = new Set<string>()

  for (const user of users) {
    if (
      !isNonEmptyString(user?.username) ||
      !isNonEmptyString(user?.displayName)
    )
      throw new Error(
        `The directory answer carries a user without a username or displayName: ${JSON.stringify(user)}. Both are what the API keys an account on, so the import cannot guess them.`
      )

    if (seen.has(user.username))
      throw new Error(
        `The directory answer names ${user.username} twice. A directory that returns one account twice is a filter problem, and importing it would hide that.`
      )

    seen.add(user.username)
  }

  return users
}

const groupsOf = (groups: DirectoryGroup[]): DirectoryGroup[] => {
  if (!Array.isArray(groups))
    throw new Error('The directory answer has no groups array.')

  const seen = new Set<string>()

  for (const group of groups) {
    if (!isNonEmptyString(group?.name))
      throw new Error(
        `The directory answer carries a group without a name: ${JSON.stringify(group)}.`
      )

    if (seen.has(group.name))
      throw new Error(
        `The directory answer names the group ${group.name} twice, which would apply its members twice.`
      )

    seen.add(group.name)
  }

  return groups
}

/**
 * The import, over the host's store.
 *
 * `IdentityStore` is the port rather than `RecordService`, because the records
 * routes require a password (a local account has one to set) and a
 * provider-managed account does not: the host's directory is where it
 * authenticates, and `passwordMatches` answers for it.
 */
export const createDirectoryService = (
  store: IdentityStore,
  source: DirectorySource,
  options: DirectoryServiceOptions = {}
): DirectoryService => {
  const provider = options.provider || 'ldap'

  return {
    async synchronise() {
      const directoryUsers = usersOf(await source.users())
      const directoryGroups = groupsOf(await source.groups())

      const existingUsers = await store.users()
      const existingGroups = await store.groups()

      const userByName = new Map(
        existingUsers.map((user) => [user.username, user])
      )
      const groupByName = new Map(
        existingGroups.map((group) => [group.name, group])
      )

      // ------------------------------------------------------------- users
      const imported: IdentityUserRecord[] = []

      for (const user of directoryUsers) {
        if (userByName.has(user.username)) continue

        const created = await store.createUser({
          username: user.username,
          displayName: user.displayName,
          isAdmin: false,
          isActive: true,
          authProvider: provider
        })

        userByName.set(created.username, created)
        imported.push(created)
      }

      // ------------------------------------------------------------ groups
      const importedGroups: IdentityGroupRecord[] = []

      for (const group of directoryGroups) {
        if (groupByName.has(group.name)) continue

        const created = await store.createGroup({
          name: group.name,
          description: '',
          isActive: true,
          authProvider: provider
        })

        groupByName.set(created.name, created)
        importedGroups.push(created)
      }

      // -------------------------------------------------------- membership
      //
      // Only the groups this call created are touched, so a second run is a
      // no-op and an existing group keeps whatever its administrator set. The
      // union of both directions: a group lists members, and a user lists the
      // groups it belongs to.
      const membersOf = new Map<string, Set<string>>()

      const note = (groupName: string, username: string) => {
        const members = membersOf.get(groupName) || new Set<string>()
        members.add(username)
        membersOf.set(groupName, members)
      }

      for (const group of directoryGroups)
        for (const member of group.members || []) note(group.name, member)

      for (const user of directoryUsers)
        for (const groupName of user.groups || [])
          note(groupName, user.username)

      for (const group of importedGroups)
        for (const username of membersOf.get(group.name) || []) {
          const user = userByName.get(username)
          // a member the store does not know is not an error: the directory may
          // hold accounts this API was never asked to import, and inventing them
          // would be importing a user the directory did not name
          if (user) await store.addToGroup(group.uid, user.uid)
        }

      return { userCount: imported.length, groupCount: importedGroups.length }
    }
  }
}
