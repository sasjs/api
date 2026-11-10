/**
 * An `IdentityStore` over maps, for tests and for a host with no database.
 *
 * Tokens are opaque strings this store can look up, which is the shape the
 * browser build needs: no signing key, and nothing in the string a client can
 * read. They are minted from the platform's cryptographic source and carry the
 * client's lifetime, so a guessed string buys nothing and an old one stops
 * resolving. A host with real credentials - a server - supplies its own store
 * with JWTs, bcrypt and a database behind it.
 */
import type {
  IdentityClient,
  IdentityClientRecord,
  IdentityGroupRecord,
  IdentityPermissionRecord,
  IdentityStore,
  IdentityUser,
  IdentityUserRecord,
  NewGroup,
  NewPermission,
  NewUser,
  Subject,
  TokenPair,
  UserChange
} from './types.js'
import {
  DEFAULT_IDENTITY,
  IDENTITY_FORMAT,
  type IdentityFixture
} from './fixture.js'
import { ApiError } from '../types.js'

const keyOf = (subject: Subject) => `${subject.userId}|${subject.clientId}`

/** A user as the store holds one: the port's fields plus what a host may not have. */
interface StoredUser extends IdentityUser {
  autoExec?: string
  authProvider?: string
}

/** The Web Crypto surface this store needs, on a global a worker also has. */
interface RandomSource {
  getRandomValues(array: Uint8Array): Uint8Array
}

/**
 * Opaque identity strings, from the platform's cryptographic source.
 *
 * These strings are credentials: whoever holds one is the caller it names. A
 * counter or `Math.random` is a sequence a reader can reproduce, so it would
 * let one caller name another - the store is small and demo-shaped, but a token
 * that can be guessed is not a demo quirk, it is an authentication bypass.
 *
 * `globalThis.crypto` is present in every browser and in Node from 19, which is
 * the same reach the rest of this package has (no node imports, so the browser
 * build bundles it unchanged).
 */
const randomHex = (bytes: number): string => {
  const source = (globalThis as unknown as { crypto?: RandomSource }).crypto
  if (!source)
    throw new ApiError(
      500,
      'This host has no Web Crypto (`globalThis.crypto`), so it cannot mint an unguessable identity string.'
    )

  const buffer = new Uint8Array(bytes)
  source.getRandomValues(buffer)
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}

/**
 * How long a code buys tokens, in seconds.
 *
 * The same lifetime `sasjs/server` signs into its auth code JWT, so a code a
 * mock issues and one a server issues age out together.
 */
const CODE_LIFETIME_SECONDS = 30

/** A string this store mints, and the instant it stops naming its subject. */
interface Issued {
  subject: Subject
  /** Milliseconds since the epoch. Absent for a seeded string, which never expires. */
  expiresAt?: number
}

const live = (issued: Issued | undefined, now: number): Subject | undefined =>
  issued && (issued.expiresAt === undefined || issued.expiresAt > now)
    ? issued.subject
    : undefined

/**
 * Whether a token minted for one subject names the same user and client.
 *
 * The fixture can declare a token that outlives the map it is seeded into, so
 * the read paths compare rather than trust the reference.
 */
export class MemoryIdentityStore implements IdentityStore {
  private readonly userList: StoredUser[] = []
  private readonly passwords = new Map<string, string>()
  private readonly groupList = new Map<string, IdentityGroupRecord>()
  private readonly permissionList = new Map<string, IdentityPermissionRecord>()
  private readonly clientRecords = new Map<string, IdentityClientRecord>()
  private readonly clientMap = new Map<string, IdentityClient>()
  private readonly pairs = new Map<string, TokenPair>()
  private readonly access = new Map<string, Issued>()
  private readonly refresh = new Map<string, Issued>()
  private readonly codes = new Map<string, Issued>()
  private readonly claimed = new Set<string>()

  constructor(fixture: IdentityFixture = DEFAULT_IDENTITY) {
    if (fixture.format !== IDENTITY_FORMAT)
      throw new ApiError(
        500,
        `The identity fixture states format ${String(fixture.format)}; this store reads ${IDENTITY_FORMAT}.`
      )

    for (const user of fixture.users) {
      this.userList.push({
        uid: user.uid,
        username: user.username,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
        isActive: user.isActive,
        needsToUpdatePassword: user.needsToUpdatePassword,
        authProvider: user.authProvider,
        autoExec: user.autoExec
      })
      this.passwords.set(user.uid, user.password)
    }

    for (const client of fixture.clients) {
      this.clientMap.set(client.clientId, {
        clientId: client.clientId,
        accessTokenExpiration: client.accessTokenExpiration,
        refreshTokenExpiration: client.refreshTokenExpiration
      })
      this.clientRecords.set(client.clientId, {
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        accessTokenExpiration: client.accessTokenExpiration,
        refreshTokenExpiration: client.refreshTokenExpiration
      })
    }

    for (const group of fixture.groups) {
      const uid = group.uid
      this.groupList.set(uid, {
        uid,
        name: group.name,
        description: group.description,
        isActive: group.isActive,
        authProvider: group.authProvider,
        users: group.users
          .map(
            (username) =>
              this.userList.find((user) => user.username === username)?.uid
          )
          .filter((member): member is string => member !== undefined)
      })
    }

    for (const permission of fixture.permissions) {
      this.permissionList.set(permission.uid, {
        uid: permission.uid,
        path: permission.path,
        type: permission.type,
        setting: permission.setting,
        user: permission.user
          ? this.userList.find((user) => user.uid === permission.user)?.uid
          : undefined,
        group: permission.group
          ? this.groupList.get(permission.group)?.uid
          : undefined
      })
    }

    for (const token of fixture.tokens || []) {
      const user = this.userList.find(
        (candidate) => candidate.username === token.username
      )
      if (!user) continue
      const subject: Subject = { userId: user.uid, clientId: token.clientId }
      if (token.accessToken) this.access.set(token.accessToken, { subject })
      if (token.refreshToken) this.refresh.set(token.refreshToken, { subject })
      // a seeded token is the subject's live pair, which is what makes it
      // authenticate: the read paths check the pair, not the token alone
      if (token.accessToken && token.refreshToken)
        this.pairs.set(keyOf(subject), {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken
        })
    }

    for (const code of fixture.codes || []) {
      const user = this.userList.find(
        (candidate) => candidate.username === code.username
      )
      if (!user) continue
      this.codes.set(code.code, {
        subject: { userId: user.uid, clientId: code.clientId }
      })
    }
  }

  async userByName(username: string): Promise<IdentityUserRecord | undefined> {
    const user = this.userList.find(
      (candidate) => candidate.username === username
    )
    return user ? this.recordOf(user) : undefined
  }

  async userById(uid: string): Promise<IdentityUserRecord | undefined> {
    const user = this.userList.find((candidate) => candidate.uid === uid)
    return user ? this.recordOf(user) : undefined
  }

  /** A fixture holds the password in clear, so the check is an equality. */
  async passwordMatches(
    user: IdentityUser,
    password: string
  ): Promise<boolean> {
    return this.passwords.get(user.uid) === password
  }

  async client(clientId: string): Promise<IdentityClient | undefined> {
    return this.clientMap.get(clientId)
  }

  async issue(subject: Subject, client: IdentityClient): Promise<TokenPair> {
    // The lifetimes are the client's, recorded against the instant of issue: a
    // token's expiry is a fact about this pair, so the read paths can answer
    // "invalid or expired" rather than carrying a number nothing compares.
    const issuedAt = Date.now()
    const pair: TokenPair = {
      accessToken: `access-${randomHex(16)}`,
      refreshToken: `refresh-${randomHex(16)}`
    }
    this.access.set(pair.accessToken, {
      subject,
      expiresAt: issuedAt + client.accessTokenExpiration * 1000
    })
    this.refresh.set(pair.refreshToken, {
      subject,
      expiresAt: issuedAt + client.refreshTokenExpiration * 1000
    })
    return pair
  }

  /**
   * A token names its subject only while that subject's CURRENT pair holds it.
   * The server verifies a token against the pair saved for the user and client,
   * so a logged-out or rotated token stops working there too; without the same
   * check here, the browser host would honour a token the server had revoked.
   */
  async readAccess(token: string): Promise<Subject | undefined> {
    return this.current(token, this.access, 'accessToken')
  }

  async readRefresh(token: string): Promise<Subject | undefined> {
    return this.current(token, this.refresh, 'refreshToken')
  }

  private current(
    token: string,
    issued: Map<string, Issued>,
    kind: 'accessToken' | 'refreshToken'
  ): Subject | undefined {
    const entry = issued.get(token)
    if (!entry) return undefined

    const subject = live(entry, Date.now())
    if (!subject) return undefined

    const pair = this.pairs.get(keyOf(subject))
    return pair && pair[kind] === token ? subject : undefined
  }

  /**
   * The subject's saved pair, while both of its tokens are still live.
   *
   * An exchange hands a saved pair back rather than rotating a second tab's
   * tokens. That is only an answer if the pair can still be used: a saved pair
   * whose access token has aged out would sign the caller in and then refuse
   * every request it makes, so an aged-out pair is reported as absent and the
   * exchange mints a fresh one. `live()` reads the issue-time expiry, which a
   * seeded token does not carry - a seeded pair therefore never ages out here.
   */
  async pairFor(subject: Subject): Promise<TokenPair | undefined> {
    const pair = this.pairs.get(keyOf(subject))
    if (!pair) return undefined

    const now = Date.now()
    const access = this.access.get(pair.accessToken)
    const refresh = this.refresh.get(pair.refreshToken)

    return live(access, now) && live(refresh, now) ? pair : undefined
  }

  async savePair(subject: Subject, pair: TokenPair): Promise<void> {
    this.pairs.set(keyOf(subject), pair)
  }

  async deletePair(subject: Subject): Promise<void> {
    this.pairs.delete(keyOf(subject))
  }

  async issueCode(subject: Subject): Promise<string> {
    const code = `code-${randomHex(16)}`
    this.codes.set(code, {
      subject,
      expiresAt: Date.now() + CODE_LIFETIME_SECONDS * 1000
    })
    return code
  }

  async readCode(code: string): Promise<Subject | undefined> {
    return live(this.codes.get(code), Date.now())
  }

  async claimCode(code: string): Promise<boolean> {
    if (this.claimed.has(code) || !this.codes.has(code)) return false
    this.claimed.add(code)
    return true
  }

  // ---------------------------------------------------------------- records

  async users(): Promise<IdentityUserRecord[]> {
    return this.userList.map((user) => this.recordOf(user))
  }

  /** A user as the administration routes report one: groups derived, not stored. */
  private recordOf(user: StoredUser): IdentityUserRecord {
    return {
      ...user,
      groups: [...this.groupList.values()]
        .filter((group) => group.users.includes(user.uid))
        .map((group) => group.uid)
    }
  }

  async createUser(input: NewUser): Promise<IdentityUserRecord> {
    const user: StoredUser = {
      uid: `user-${randomHex(6)}`,
      username: input.username,
      displayName: input.displayName,
      isAdmin: input.isAdmin,
      isActive: input.isActive,
      needsToUpdatePassword: false,
      autoExec: input.autoExec,
      authProvider: input.authProvider
    }
    this.userList.push(user)
    return this.recordOf(user)
  }

  async updateUser(
    uid: string,
    change: UserChange
  ): Promise<IdentityUserRecord | undefined> {
    const user = this.userList.find((candidate) => candidate.uid === uid)
    if (!user) return undefined

    if (change.username !== undefined) user.username = change.username
    if (change.displayName !== undefined) user.displayName = change.displayName
    if (change.isAdmin !== undefined) user.isAdmin = change.isAdmin
    if (change.isActive !== undefined) user.isActive = change.isActive
    if (change.needsToUpdatePassword !== undefined)
      user.needsToUpdatePassword = change.needsToUpdatePassword

    if (change.autoExec !== undefined) user.autoExec = change.autoExec
    return this.recordOf(user)
  }

  async deleteUser(uid: string): Promise<void> {
    const index = this.userList.findIndex((user) => user.uid === uid)
    if (index === -1) return
    this.userList.splice(index, 1)
    this.passwords.delete(uid)
    for (const group of this.groupList.values())
      group.users = group.users.filter((member) => member !== uid)
    for (const [key, permission] of this.permissionList)
      if (permission.user === uid) this.permissionList.delete(key)
    for (const key of this.pairs.keys())
      if (key.startsWith(`${uid}|`)) this.pairs.delete(key)
  }

  async setPassword(uid: string, password: string): Promise<void> {
    this.passwords.set(uid, password)
  }

  async groups(): Promise<IdentityGroupRecord[]> {
    return [...this.groupList.values()]
  }

  async groupById(uid: string): Promise<IdentityGroupRecord | undefined> {
    return this.groupList.get(uid)
  }

  async groupByName(name: string): Promise<IdentityGroupRecord | undefined> {
    return [...this.groupList.values()].find((group) => group.name === name)
  }

  async createGroup(input: NewGroup): Promise<IdentityGroupRecord> {
    const group: IdentityGroupRecord = {
      uid: `group-${randomHex(6)}`,
      name: input.name,
      description: input.description,
      isActive: input.isActive,
      users: [],
      ...(input.authProvider === undefined
        ? {}
        : { authProvider: input.authProvider })
    }
    this.groupList.set(group.uid, group)
    return group
  }

  async deleteGroup(uid: string): Promise<void> {
    this.groupList.delete(uid)
    for (const [key, permission] of this.permissionList)
      if (permission.group === uid) this.permissionList.delete(key)
  }

  async addToGroup(
    groupUid: string,
    userUid: string
  ): Promise<IdentityGroupRecord | undefined> {
    const group = this.groupList.get(groupUid)
    if (!group) return undefined
    if (!group.users.includes(userUid)) group.users.push(userUid)
    return group
  }

  async removeFromGroup(
    groupUid: string,
    userUid: string
  ): Promise<IdentityGroupRecord | undefined> {
    const group = this.groupList.get(groupUid)
    if (!group) return undefined
    group.users = group.users.filter((member) => member !== userUid)
    return group
  }

  async permissions(): Promise<IdentityPermissionRecord[]> {
    return [...this.permissionList.values()]
  }

  async permissionById(
    uid: string
  ): Promise<IdentityPermissionRecord | undefined> {
    return this.permissionList.get(uid)
  }

  async createPermission(
    input: NewPermission
  ): Promise<IdentityPermissionRecord> {
    const permission: IdentityPermissionRecord = {
      uid: `rule-${randomHex(6)}`,
      path: input.path,
      type: input.type,
      setting: input.setting,
      user: input.user,
      group: input.group
    }
    this.permissionList.set(permission.uid, permission)
    return permission
  }

  async setPermissionSetting(
    uid: string,
    setting: string
  ): Promise<IdentityPermissionRecord | undefined> {
    const permission = this.permissionList.get(uid)
    if (!permission) return undefined
    permission.setting = setting
    return permission
  }

  async deletePermission(uid: string): Promise<void> {
    this.permissionList.delete(uid)
  }

  async clients(): Promise<IdentityClientRecord[]> {
    return [...this.clientRecords.values()]
  }

  async createClient(
    input: IdentityClientRecord
  ): Promise<IdentityClientRecord> {
    this.clientRecords.set(input.clientId, input)
    this.clientMap.set(input.clientId, {
      clientId: input.clientId,
      accessTokenExpiration: input.accessTokenExpiration,
      refreshTokenExpiration: input.refreshTokenExpiration
    })
    return input
  }

  /**
   * The fixture this store would be seeded from now.
   *
   * A host that persists the store - the browser build keeps it beside the
   * drive - writes this object and seeds the next boot from it, so the file a
   * person reads and the object the store speaks are the same shape. Passwords
   * are carried because a seed needs them to sign in: the administration
   * records deliberately leave them out, and a snapshot that did too would be a
   * fixture no one could log into.
   *
   * Tokens and authorization codes are absent on purpose. They are credentials
   * with a lifetime, minted per session; a persisted one would authenticate a
   * caller after the pair it names had been rotated or revoked, which is the
   * failure a token store exists to prevent.
   */
  snapshot(): IdentityFixture {
    return {
      format: IDENTITY_FORMAT,
      users: this.userList.map((user) => ({
        ...user,
        password: this.passwords.get(user.uid) || ''
      })),
      groups: [...this.groupList.values()].map((group) => ({
        ...group,
        users: [...group.users]
      })),
      permissions: [...this.permissionList.values()].map((permission) => ({
        ...permission
      })),
      clients: [...this.clientRecords.values()].map((client) => ({ ...client }))
    }
  }
}
