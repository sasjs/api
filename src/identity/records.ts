/**
 * Users, groups, permission rules and clients: the administration routes'
 * decisions, over the same store the sign-in flow uses.
 *
 * The server answers these from four controllers and two middlewares - the
 * statuses, the messages and the order of the checks are copied from there, so a
 * mock and a server refuse a request the same way. What stays with the host is
 * the *transport* (a session or a bearer token, a CSRF token) and the things a
 * host owns: a new user's home folder, a directory bind, an audit trail.
 *
 * The admin gate is here rather than in a caller because `dispatch` has no
 * middleware: `requireAdmin` is `verifyAdmin`, and `requireSelfOrAdmin` is
 * `verifyAdminIfNeeded`. Both answer `401 Admin account required`, which is what
 * the server sends.
 */
import { ApiError } from '../types.js'
import {
  ALWAYS_VISIBLE_ROUTES,
  DEFAULT_GRANTABLE_ROUTES,
  isRouteGranted,
  topLevelRouteFor
} from './routeAccess.js'
import type { RouteRules } from './routeAccess.js'
import type {
  IdentityClientRecord,
  IdentityGroupRecord,
  IdentityPermissionRecord,
  IdentityStore,
  IdentityUserRecord,
  Subject
} from './types.js'

/** The body a client reads for a user, as the server's controllers return it. */
export interface UserResponse {
  uid: string
  username: string
  displayName: string
  isAdmin: boolean
}

export interface UserDetailsResponse extends UserResponse {
  isActive: boolean
  needsToUpdatePassword: boolean
  autoExec?: string
  groups?: { uid: string; name: string; description: string }[]
}

export interface GroupResponse {
  uid: string
  name: string
  description: string
}

export interface GroupDetailsResponse extends GroupResponse {
  isActive: boolean
  users: UserResponse[]
}

/**
 * A permission rule as the routes report one.
 *
 * The principal is the identifier, not the whole account: a rule is a row in a
 * table, and a host on any database can produce `user` or `group` as a uid
 * without a join or a populate step. A client that wants the name asks for the
 * account it names, which it can do whether the store is Mongo, a browser's
 * IndexedDB or a file.
 */
export interface PermissionResponse {
  uid: string
  path: string
  type: string
  setting: string
  /** The uid of the account the rule is assigned to, when it is a user's. */
  user?: string
  /** The uid of the group the rule is assigned to, when it is a group's. */
  group?: string
}

/** What `authorizedRoutes` and `myAuthorizedRoutes` answer. */
export interface AuthorizedRoutesResponse {
  paths: string[]
}

export interface RecordService {
  listUsers(caller: Subject | undefined): Promise<UserResponse[]>
  getUser(
    caller: Subject | undefined,
    by: { uid?: string; username?: string }
  ): Promise<UserDetailsResponse>
  createUser(
    caller: Subject | undefined,
    body: {
      username: string
      displayName: string
      password: string
      isAdmin?: boolean
      isActive?: boolean
      autoExec?: string
    }
  ): Promise<UserDetailsResponse>
  updateUser(
    caller: Subject | undefined,
    by: { uid?: string; username?: string },
    body: {
      username?: string
      displayName?: string
      password?: string
      isAdmin?: boolean
      isActive?: boolean
      autoExec?: string
    }
  ): Promise<UserDetailsResponse>
  deleteUser(
    caller: Subject | undefined,
    by: { uid?: string; username?: string },
    body: { password?: string }
  ): Promise<string>

  listGroups(caller: Subject | undefined): Promise<GroupResponse[]>
  getGroup(
    caller: Subject | undefined,
    by: { uid?: string; name?: string }
  ): Promise<GroupDetailsResponse>
  createGroup(
    caller: Subject | undefined,
    body: { name: string; description: string; isActive?: boolean }
  ): Promise<GroupDetailsResponse>
  deleteGroup(caller: Subject | undefined, uid: string): Promise<void>
  addUserToGroup(
    caller: Subject | undefined,
    groupUid: string,
    userUid: string
  ): Promise<GroupDetailsResponse>
  removeUserFromGroup(
    caller: Subject | undefined,
    groupUid: string,
    userUid: string
  ): Promise<GroupDetailsResponse>

  /**
   * The routes that accept a rule. Any authenticated caller may read it: it is
   * the inventory, not a statement about what this caller holds.
   */
  listAuthorizedRoutes(
    caller: Subject | undefined
  ): Promise<AuthorizedRoutesResponse>

  /** The routes this caller may use, from the rules that bear on them. */
  myAuthorizedRoutes(
    caller: Subject | undefined
  ): Promise<AuthorizedRoutesResponse>

  listPermissions(caller: Subject | undefined): Promise<PermissionResponse[]>
  createPermission(
    caller: Subject | undefined,
    body: {
      path: string
      type: string
      setting: string
      principalType: string
      principalId: string
    }
  ): Promise<PermissionResponse>
  updatePermission(
    caller: Subject | undefined,
    uid: string,
    body: { setting: string }
  ): Promise<PermissionResponse>
  deletePermission(caller: Subject | undefined, uid: string): Promise<string>

  listClients(caller: Subject | undefined): Promise<IdentityClientRecord[]>
  createClient(
    caller: Subject | undefined,
    body: IdentityClientRecord
  ): Promise<IdentityClientRecord>

  /** `PATCH /SASjsApi/auth/updatePassword`, the caller's own password. */
  updatePassword(
    caller: Subject | undefined,
    body: { currentPassword: string; newPassword: string }
  ): Promise<void>
}

/** The name the server gives the group every account is added to on creation. */
const ALL_USERS_GROUP = 'all-users'

/** The group whose membership the API refuses to change. */
const PUBLIC_GROUP = 'public'

const unauthorized = () => new ApiError(401, 'Unauthorized')

/**
 * The caller, while the account behind it may still act.
 *
 * Every administration route reads the caller through this: the server
 * re-reads the user on every request and refuses a deactivated account, so a
 * token or session that outlived the account must not administer anything.
 */
const requireCaller = async (
  store: IdentityStore,
  caller: Subject | undefined
): Promise<IdentityUserRecord> => {
  if (!caller) throw unauthorized()
  const user = await store.userById(caller.userId)
  if (!user || !user.isActive) throw unauthorized()
  return user
}

/** `verifyAdmin`: the caller is an administrator, or the route refuses. */
const requireAdmin = async (
  store: IdentityStore,
  caller: Subject | undefined
): Promise<IdentityUserRecord> => {
  const user = await requireCaller(store, caller)
  if (!user.isAdmin) throw new ApiError(401, 'Admin account required')
  return user
}

/**
 * `verifyAdminIfNeeded`: an administrator, or the account being acted on.
 *
 * The server compares `req.params.uid` / `.username` with the caller's own
 * identifier, which is why the target is passed in rather than read from the
 * body - a restful route names its subject in the path.
 */
const requireSelfOrAdmin = async (
  store: IdentityStore,
  caller: Subject | undefined,
  target: IdentityUserRecord | undefined
): Promise<IdentityUserRecord> => {
  const user = await requireCaller(store, caller)
  if (!user.isAdmin && user.uid !== target?.uid)
    throw new ApiError(401, 'Admin account required')
  return user
}

/**
 * A display name, as the server stores one: control characters out, trimmed and
 * bounded.
 *
 * The value reaches generated stored-program source and webout headers, so the
 * server sanitises on the way in; a host that stored it verbatim would hold a
 * different value from the server for the same request.
 */
const MAX_DISPLAY_NAME_LENGTH = 100

export const sanitiseDisplayName = (value: unknown): string =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH)

const asUser = (user: IdentityUserRecord): UserResponse => ({
  uid: user.uid,
  username: user.username,
  displayName: user.displayName,
  isAdmin: user.isAdmin
})

const asGroup = (group: IdentityGroupRecord): GroupResponse => ({
  uid: group.uid,
  name: group.name,
  description: group.description
})

export interface RecordServiceOptions {
  /**
   * The routes that accept a permission rule. Defaults to the ones this package
   * knows; a host that streams applications adds `/AppStream/<app>` for each,
   * because that set is the host's configuration and not a fact about the API.
   */
  grantableRoutes?: string[]
}

export const createRecordService = (
  store: IdentityStore,
  options: RecordServiceOptions = {}
): RecordService => {
  const grantableRoutes = options.grantableRoutes || DEFAULT_GRANTABLE_ROUTES

  const groupDetails = async (
    group: IdentityGroupRecord
  ): Promise<GroupDetailsResponse> => {
    const members: UserResponse[] = []
    for (const uid of group.users) {
      const user = await store.userById(uid)
      if (user) members.push(asUser(user))
    }
    return { ...asGroup(group), isActive: group.isActive, users: members }
  }

  const userDetails = async (
    user: IdentityUserRecord,
    withAutoExec: boolean
  ): Promise<UserDetailsResponse> => {
    const groups: { uid: string; name: string; description: string }[] = []
    for (const uid of user.groups) {
      const group = await store.groupById(uid)
      if (group) groups.push(asGroup(group))
    }
    const details: UserDetailsResponse = {
      ...asUser(user),
      isActive: user.isActive,
      needsToUpdatePassword: user.needsToUpdatePassword,
      groups
    }
    if (withAutoExec) details.autoExec = user.autoExec ?? ''
    return details
  }

  const findBy = async (by: {
    uid?: string
    username?: string
  }): Promise<IdentityUserRecord | undefined> =>
    by.uid !== undefined
      ? store.userById(by.uid)
      : store.userByName(by.username ?? '')

  const permissionDetails = async (
    permission: IdentityPermissionRecord
  ): Promise<PermissionResponse> => ({
    uid: permission.uid,
    path: permission.path,
    type: permission.type,
    setting: permission.setting,
    ...(permission.user ? { user: permission.user } : {}),
    ...(permission.group ? { group: permission.group } : {})
  })

  return {
    async listUsers(caller) {
      await requireCaller(store, caller)
      const users = await store.users()
      return users.map(asUser)
    },

    async getUser(caller, by) {
      const reader = await requireCaller(store, caller)
      const user = await findBy(by)
      if (!user) throw new ApiError(404, 'User is not found.')

      // the server hands the auto-exec code to an administrator or to the user
      // themselves and omits it for anyone else
      const withAutoExec = reader.isAdmin || reader.uid === user.uid
      return userDetails(user, withAutoExec)
    },

    async createUser(caller, body) {
      await requireAdmin(store, caller)

      if (await store.userByName(body.username))
        throw new ApiError(409, 'Username already exists.')

      const created = await store.createUser({
        username: body.username,
        displayName: sanitiseDisplayName(body.displayName),
        isAdmin: body.isAdmin === true,
        isActive: body.isActive !== false,
        autoExec: body.autoExec
      })
      await store.setPassword(created.uid, body.password)

      // the server adds every new account to the all-users group when the host
      // has one, so a group-based grant reaches it without an explicit add
      const allUsers = await store.groupByName(ALL_USERS_GROUP)
      if (allUsers) await store.addToGroup(allUsers.uid, created.uid)

      const stored = await store.userById(created.uid)
      return userDetails(stored ?? created, true)
    },

    async updateUser(caller, by, body) {
      const current = await findBy(by)
      await requireSelfOrAdmin(store, caller, current)

      const change: {
        username?: string
        displayName?: string
        isAdmin?: boolean
        isActive?: boolean
        autoExec?: string
      } = {}
      const displayName = sanitiseDisplayName(body.displayName)

      // the provider checks come before the uniqueness check and before the
      // update, in the server's order: a provider-managed account cannot have
      // its identity fields changed, and saying so does not depend on the new
      // value being free
      if (
        body.username &&
        body.username !== current?.username &&
        current?.authProvider
      )
        throw new ApiError(
          405,
          'Can not update username of user that is created by an external auth provider.'
        )

      if (
        displayName &&
        displayName !== current?.displayName &&
        current?.authProvider
      )
        throw new ApiError(
          405,
          'Can not update display name of user that is created by an external auth provider.'
        )

      if (body.username) {
        const holder = await store.userByName(body.username)
        if (holder && holder.uid !== current?.uid)
          throw new ApiError(409, 'Username already exists.')
        change.username = body.username
      }

      if (displayName) change.displayName = displayName
      if (body.isAdmin !== undefined) change.isAdmin = body.isAdmin
      if (body.isActive !== undefined) change.isActive = body.isActive
      if (body.autoExec !== undefined) change.autoExec = body.autoExec

      const updated = current
        ? await store.updateUser(current.uid, change)
        : undefined
      if (!updated)
        throw new ApiError(
          404,
          `Unable to find user with ${by.uid || by.username}`
        )

      if (body.password) await store.setPassword(updated.uid, body.password)

      const stored = await store.userById(updated.uid)
      return userDetails(stored ?? updated, true)
    },

    async deleteUser(caller, by, body) {
      const current = await findBy(by)
      const actor = await requireSelfOrAdmin(store, caller, current)
      if (!current) throw new ApiError(404, 'User is not found.')

      // an administrator deletes without proving the password; anyone else
      // deleting their own account proves it. The caller's admin flag is the
      // server's `@Hidden() isAdmin` query parameter, resolved here from the
      // caller's own record rather than trusted from the request.
      if (!actor.isAdmin) {
        if (!(await store.passwordMatches(current, body.password ?? '')))
          throw new ApiError(401, 'Invalid password.')
      }

      await store.deleteUser(current.uid)

      // the server's route sends this string itself; the document carries it as
      // the 200 description, so it is the answer and not an extra
      return 'Account Deleted!'
    },

    async listGroups(caller) {
      await requireCaller(store, caller)
      const groups = await store.groups()
      return groups.map(asGroup)
    },

    async getGroup(caller, by) {
      await requireCaller(store, caller)
      const group =
        by.uid !== undefined
          ? await store.groupById(by.uid)
          : await store.groupByName(by.name ?? '')
      if (!group) throw new ApiError(404, 'Group not found.')
      return groupDetails(group)
    },

    async createGroup(caller, body) {
      await requireAdmin(store, caller)
      if (await store.groupByName(body.name))
        throw new ApiError(409, 'Group name already exists.')

      const created = await store.createGroup({
        name: body.name,
        description: body.description,
        isActive: body.isActive !== false
      })
      return groupDetails(created)
    },

    async deleteGroup(caller, uid) {
      await requireAdmin(store, caller)
      if (!(await store.groupById(uid)))
        throw new ApiError(404, 'Group not found.')
      await store.deleteGroup(uid)
    },

    async addUserToGroup(caller, groupUid, userUid) {
      await requireAdmin(store, caller)
      const group = await store.groupById(groupUid)
      if (!group) throw new ApiError(404, 'Group not found.')
      if (group.name === PUBLIC_GROUP)
        throw new ApiError(
          400,
          `Can't add/remove user to '${PUBLIC_GROUP}' group.`
        )
      if (group.authProvider)
        throw new ApiError(
          405,
          "Can't add/remove user to group created by external auth provider."
        )

      const user = await store.userById(userUid)
      if (!user) throw new ApiError(404, 'User not found.')
      if (user.authProvider)
        throw new ApiError(
          405,
          "Can't add/remove user to group created by external auth provider."
        )

      const updated = await store.addToGroup(groupUid, userUid)
      if (!updated) throw new ApiError(400, 'Unable to update group.')
      return groupDetails(updated)
    },

    async removeUserFromGroup(caller, groupUid, userUid) {
      await requireAdmin(store, caller)
      const group = await store.groupById(groupUid)
      if (!group) throw new ApiError(404, 'Group not found.')
      if (group.name === PUBLIC_GROUP)
        throw new ApiError(
          400,
          `Can't add/remove user to '${PUBLIC_GROUP}' group.`
        )
      if (group.authProvider)
        throw new ApiError(
          405,
          "Can't add/remove user to group created by external auth provider."
        )

      const user = await store.userById(userUid)
      if (!user) throw new ApiError(404, 'User not found.')
      if (user.authProvider)
        throw new ApiError(
          405,
          "Can't add/remove user to group created by external auth provider."
        )

      const updated = await store.removeFromGroup(groupUid, userUid)
      if (!updated) throw new ApiError(400, 'Unable to update group.')
      return groupDetails(updated)
    },

    async listAuthorizedRoutes(caller) {
      // The inventory is for the administration dialog, and it is admin-only:
      // the routes a caller may reach are reconnaissance, and a non-administrator
      // learns their own access from `myAuthorizedRoutes` instead. The refusal is
      // the host's too - sasjs/server gates the same path with `verifyAdmin` -
      // which is why the message matches what a caller sees there.
      const reader = await requireCaller(store, caller)
      if (!reader.isAdmin) throw new ApiError(401, 'Admin account required')

      return { paths: [...grantableRoutes] }
    },

    async myAuthorizedRoutes(caller) {
      const reader = await requireCaller(store, caller)

      // an administrator holds every route, and the always-visible ones are
      // visible whatever the rules say
      if (reader.isAdmin) return { paths: [...grantableRoutes] }

      const rules = await store.permissions()
      const mine: RouteRules = {
        user: rules
          .filter((rule) => rule.user === reader.uid)
          .map((rule) => ({ path: rule.path, setting: rule.setting })),
        group: rules
          .filter(
            (rule) =>
              rule.group !== undefined && reader.groups.includes(rule.group)
          )
          .map((rule) => ({ path: rule.path, setting: rule.setting }))
      }

      // a grant on the reserved public group admits any caller, and it is
      // checked before the rules so no user or group rule can take it away
      const publicGroup = (await store.groups()).find(
        (group) => group.name === 'public'
      )
      const publicGrants = publicGroup
        ? rules
            .filter(
              (rule) =>
                rule.group === publicGroup.uid && rule.setting === 'Grant'
            )
            .map((rule) => rule.path)
        : []

      return {
        paths: grantableRoutes.filter(
          (path) =>
            ALWAYS_VISIBLE_ROUTES.includes(path) ||
            publicGrants.includes(path) ||
            isRouteGranted(mine, path, topLevelRouteFor(path))
        )
      }
    },

    async listPermissions(caller) {
      const reader = await requireCaller(store, caller)
      const rules = await store.permissions()

      // an administrator sees every rule; anyone else sees the rules assigned to
      // them and to the groups they belong to, which is what an app renders its
      // menus from
      const visible = reader.isAdmin
        ? rules
        : rules.filter(
            (rule) =>
              rule.user === reader.uid ||
              (rule.group !== undefined && reader.groups.includes(rule.group))
          )

      const out: PermissionResponse[] = []
      for (const rule of visible) out.push(await permissionDetails(rule))
      return out
    },

    async createPermission(caller, body) {
      await requireAdmin(store, caller)

      if (body.principalType === 'user') {
        const user = await store.userById(body.principalId)
        if (!user) throw new ApiError(404, 'User not found.')
        if (user.isAdmin)
          throw new ApiError(400, 'Can not add permission for admin user.')

        const exists = (await store.permissions()).some(
          (rule) =>
            rule.path === body.path &&
            rule.type === body.type &&
            rule.user === body.principalId
        )
        if (exists)
          throw new ApiError(
            409,
            'Permission already exists with provided Path, Type and User.'
          )

        const created = await store.createPermission({
          path: body.path,
          type: body.type,
          setting: body.setting,
          user: body.principalId
        })
        return permissionDetails(created)
      }

      if (body.principalType === 'group') {
        const group = await store.groupById(body.principalId)
        if (!group) throw new ApiError(404, 'Group not found.')

        const exists = (await store.permissions()).some(
          (rule) =>
            rule.path === body.path &&
            rule.type === body.type &&
            rule.group === body.principalId
        )
        if (exists)
          throw new ApiError(
            409,
            'Permission already exists with provided Path, Type and Group.'
          )

        const created = await store.createPermission({
          path: body.path,
          type: body.type,
          setting: body.setting,
          group: body.principalId
        })
        return permissionDetails(created)
      }

      throw new ApiError(
        400,
        'Invalid principal type. Valid types are user or group.'
      )
    },

    async updatePermission(caller, uid, body) {
      await requireAdmin(store, caller)
      const updated = await store.setPermissionSetting(uid, body.setting)
      if (!updated) throw new ApiError(404, 'Permission not found.')
      return permissionDetails(updated)
    },

    async deletePermission(caller, uid) {
      await requireAdmin(store, caller)
      if (!(await store.permissionById(uid)))
        throw new ApiError(404, 'Permission not found.')
      await store.deletePermission(uid)

      return 'Permission Deleted!'
    },

    async listClients(caller) {
      await requireAdmin(store, caller)
      return store.clients()
    },

    async createClient(caller, body) {
      await requireAdmin(store, caller)
      // the server answers `res.status(403).send(err.toString())`, so the body a
      // client receives carries the Error prefix
      if (await store.client(body.clientId))
        throw new ApiError(403, 'Error: Client ID already exists.')

      return store.createClient({
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        accessTokenExpiration: body.accessTokenExpiration,
        refreshTokenExpiration: body.refreshTokenExpiration
      })
    },

    async updatePassword(caller, body) {
      // requireCaller answers 401 for a caller that is absent or deactivated, so
      // the document's 404 (a caller whose record has gone) cannot be reached
      // here - the overlay records that as a host-only status.
      const reader = await requireCaller(store, caller)

      if (reader.authProvider)
        throw new ApiError(
          405,
          'Can not update password of user that is created by an external auth provider.'
        )

      if (!(await store.passwordMatches(reader, body.currentPassword)))
        throw new ApiError(403, 'Invalid current password!')

      await store.setPassword(reader.uid, body.newPassword)
      // the flag is what makes the web interface ask, and the server clears it in
      // the same write: it has to go through the store, or a host keeps refusing
      // every call the caller makes after the change
      await store.updateUser(reader.uid, { needsToUpdatePassword: false })
    }
  }
}
