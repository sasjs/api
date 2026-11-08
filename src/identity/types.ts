/**
 * The identity the API works over, as a host supplies it.
 *
 * A server holds users in a database, verifies a bcrypt hash and signs JWTs; a
 * browser build holds a seeded fixture, compares a plain-text demo password and
 * mints opaque strings. Those differences are the host's, so they live behind
 * this port - the statuses, the messages and the order of the checks are the
 * service's, and both hosts run the same corpus over them.
 */

/** The caller a token names: a user, and the client the token was issued for. */
export interface Subject {
  userId: string
  clientId: string
}

export interface IdentityUser {
  uid: string
  username: string
  displayName: string
  isAdmin: boolean
  isActive: boolean
  needsToUpdatePassword: boolean
}

export interface IdentityClient {
  clientId: string
  /** Seconds an access token lives, as the client is configured. */
  accessTokenExpiration: number
  /** Seconds a refresh token lives. */
  refreshTokenExpiration: number
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

/**
 * Users, clients, token pairs and auth codes, plus the cryptography that names
 * a subject in a token.
 *
 * Minting and reading a token sit here rather than on a separate codec because
 * they are one decision: a host that signs JWTs also verifies them against the
 * same secret, and a host with no signing key issues opaque strings it can look
 * up. Splitting them would let a host pair one host's minting with another's
 * verification, which is never what anyone means.
 */
export interface IdentityStore {
  userByName(username: string): Promise<IdentityUserRecord | undefined>
  userById(uid: string): Promise<IdentityUserRecord | undefined>
  /**
   * Whether the password matches. The host owns the check: a bcrypt hash, a
   * directory bind, or a fixture's declared demo password.
   */
  passwordMatches(user: IdentityUser, password: string): Promise<boolean>
  client(clientId: string): Promise<IdentityClient | undefined>
  /** A pair for the subject, with the client's own lifetimes. */
  issue(subject: Subject, client: IdentityClient): Promise<TokenPair>
  /** The subject an access token names, or undefined when it is invalid or expired. */
  readAccess(token: string): Promise<Subject | undefined>
  /** The same for a refresh token. A host may keep them in separate stores. */
  readRefresh(token: string): Promise<Subject | undefined>
  /** The pair currently held for the subject, if the host keeps one. */
  pairFor(subject: Subject): Promise<TokenPair | undefined>
  savePair(subject: Subject, pair: TokenPair): Promise<void>
  deletePair(subject: Subject): Promise<void>
  /** A single-use authorization code naming the subject. */
  issueCode(subject: Subject): Promise<string>
  /**
   * The subject a code names, without consuming it: authentic and unexpired,
   * or undefined. Read first, so a code presented with the wrong client id is
   * refused without being spent - the caller may still exchange it for the
   * client it was issued for.
   */
  readCode(code: string): Promise<Subject | undefined>
  /**
   * Spends a code, answering whether this call was the one that did. The first
   * call answers true; every later call for the same string answers false,
   * which is what makes an exchange single-use even when two requests race.
   */
  claimCode(code: string): Promise<boolean>

  // ---------------------------------------------------------------- records
  //
  // The sign-in flow reads a user and a client; the administration routes read
  // and write collections. These are the writes and the reads that have no
  // answer in the flow above, kept on the same store so a host has one place to
  // put users, groups, rules and clients.

  /** Every user, in the order the host holds them. */
  users(): Promise<IdentityUserRecord[]>
  /** Creates a user. The caller has already refused a duplicate username. */
  createUser(input: NewUser): Promise<IdentityUserRecord>
  /** Applies a change to the user named by `uid`; undefined when there is none. */
  updateUser(
    uid: string,
    change: UserChange
  ): Promise<IdentityUserRecord | undefined>
  deleteUser(uid: string): Promise<void>
  /** Sets the password the host checks against, in the host's own encoding. */
  setPassword(uid: string, password: string): Promise<void>

  groups(): Promise<IdentityGroupRecord[]>
  groupById(uid: string): Promise<IdentityGroupRecord | undefined>
  groupByName(name: string): Promise<IdentityGroupRecord | undefined>
  createGroup(input: NewGroup): Promise<IdentityGroupRecord>
  deleteGroup(uid: string): Promise<void>
  /** Membership, answering the updated group; undefined when there is none. */
  addToGroup(
    groupUid: string,
    userUid: string
  ): Promise<IdentityGroupRecord | undefined>
  removeFromGroup(
    groupUid: string,
    userUid: string
  ): Promise<IdentityGroupRecord | undefined>

  permissions(): Promise<IdentityPermissionRecord[]>
  permissionById(uid: string): Promise<IdentityPermissionRecord | undefined>
  createPermission(input: NewPermission): Promise<IdentityPermissionRecord>
  setPermissionSetting(
    uid: string,
    setting: string
  ): Promise<IdentityPermissionRecord | undefined>
  deletePermission(uid: string): Promise<void>

  clients(): Promise<IdentityClientRecord[]>
  createClient(input: IdentityClientRecord): Promise<IdentityClientRecord>
}

/**
 * A user as the administration routes report one: the fields the sign-in flow
 * reads, plus what those routes expose.
 *
 * `autoExec` and `authProvider` are optional because a host that does not hold
 * them (the browser build's fixture, a directory-backed server) answers without
 * them, and `groups` is empty rather than absent so a client always gets a list.
 */
export interface IdentityUserRecord extends IdentityUser {
  autoExec?: string
  /** Set when the account is managed by an external auth provider. */
  authProvider?: string
  /** The uids of the groups the user belongs to. */
  groups: string[]
}

export interface IdentityGroupRecord {
  uid: string
  name: string
  description: string
  isActive: boolean
  /** The uids of the members. */
  users: string[]
  /** Set when the group is managed by an external auth provider. */
  authProvider?: string
}

export interface IdentityPermissionRecord {
  uid: string
  /** The route the rule is about, e.g. `/SASjsApi/code/execute`. */
  path: string
  /** `Route` is the only kind the API defines. */
  type: string
  /** `Grant` or `Deny`. */
  setting: string
  /** The uid the rule is assigned to, when it is a user's. */
  user?: string
  /** The uid the rule is assigned to, when it is a group's. */
  group?: string
}

/** A client as the administration routes report one: the flow's fields plus the secret. */
export interface IdentityClientRecord extends IdentityClient {
  clientSecret: string
}

/** What creating a user takes. The password reaches `setPassword`, not this. */
export interface NewUser {
  username: string
  displayName: string
  isAdmin: boolean
  isActive: boolean
  autoExec?: string
  authProvider?: string
}

/** The fields an update may carry; omitted fields are left alone. */
export interface UserChange {
  username?: string
  displayName?: string
  isAdmin?: boolean
  isActive?: boolean
  autoExec?: string
  /**
   * Cleared by a password change: `sasjs/server` refuses every other API call
   * while this is set, so a host must be able to clear it through the port.
   */
  needsToUpdatePassword?: boolean
}

export interface NewGroup {
  name: string
  description: string
  isActive: boolean
  /**
   * Set when an external provider manages the group - the directory import
   * marks the groups it creates, so a host can tell them apart from local ones.
   */
  authProvider?: string
}

export interface NewPermission {
  path: string
  type: string
  setting: string
  user?: string
  group?: string
}
