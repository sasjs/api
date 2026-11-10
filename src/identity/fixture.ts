/**
 * The identity a browser build starts from, and the format it travels in.
 *
 * A shipped fixture is what makes a mock build work with no configuration: it
 * is small, legible, and declared to be fake. Passwords are plain text because
 * nothing verifies them beyond an equality check - there is no boundary here,
 * and pretending otherwise by shipping a hash would suggest one.
 *
 * `format` is stamped the way the drive's snapshot is: a store written by an
 * older build is refused with a named reason rather than misread.
 */

export const IDENTITY_FORMAT = 1

export interface IdentityFixtureUser {
  uid: string
  username: string
  displayName: string
  /**
   * Plain text on purpose: a fixture, not a credential store. Absent when the
   * account has no local password - one a directory imported authenticates
   * there, and `createUser` leaves the password to a separate `setPassword`
   * call, so a store can hold such an account as well.
   */
  password?: string
  isAdmin: boolean
  isActive: boolean
  needsToUpdatePassword: boolean
  /** Set when the account is managed by an external auth provider. */
  authProvider?: string
  /** The account's own auto-exec code, where the fixture declares one. */
  autoExec?: string
}

export interface IdentityFixtureGroup {
  uid: string
  name: string
  description: string
  isActive: boolean
  /** Usernames of the members. */
  users: string[]
  /** Set when the group is managed by an external auth provider. */
  authProvider?: string
}

export interface IdentityFixturePermission {
  uid: string
  path: string
  /** `Route` is the only kind the API defines. */
  type: string
  /** `Grant` or `Deny`. */
  setting: string
  /** The uid of the account the rule is assigned to, when it is not a group's. */
  user?: string
  /** The uid of the group the rule is assigned to, when it is not a user's. */
  group?: string
}

export interface IdentityFixtureClient {
  clientId: string
  clientSecret: string
  /** Seconds an access token lives. */
  accessTokenExpiration: number
  /** Seconds a refresh token lives. */
  refreshTokenExpiration: number
}

/** An authorization code a host should already accept, so a case can start mid-flow. */
export interface IdentityFixtureCode {
  code: string
  username: string
  clientId: string
}

/** A token a host should already accept, so a case can start signed in. */
export interface IdentityFixtureToken {
  username: string
  clientId: string
  accessToken?: string
  refreshToken?: string
}

export interface IdentityFixture {
  format: number
  users: IdentityFixtureUser[]
  groups: IdentityFixtureGroup[]
  permissions: IdentityFixturePermission[]
  clients: IdentityFixtureClient[]
  /** Tokens a host accepts before it has issued any. */
  tokens?: IdentityFixtureToken[]
  /** Authorization codes a host accepts before it has issued any. */
  codes?: IdentityFixtureCode[]
}

const SECONDS_IN_A_DAY = 86400

export const DEFAULT_IDENTITY: IdentityFixture = {
  format: IDENTITY_FORMAT,
  users: [
    {
      uid: 'user-admin',
      username: 'sasjsadmin',
      displayName: 'Demo Admin',
      // long enough to pass the API's own password rule (six characters), so a
      // demo can sign in against a real server as well as a mock
      password: 'Orion123',
      isAdmin: true,
      isActive: true,
      needsToUpdatePassword: false
    },
    {
      uid: 'user-restricted',
      username: 'sasjsuser',
      displayName: 'Demo User',
      password: 'Orion123',
      isAdmin: false,
      isActive: true,
      needsToUpdatePassword: false
    }
  ],
  groups: [
    {
      uid: 'group-data-controller',
      name: 'DCGroup',
      description: 'Data Controller users',
      isActive: true,
      users: ['sasjsuser']
    },
    {
      uid: 'group-admins',
      name: 'Admins',
      description: 'Everything the API offers',
      isActive: true,
      users: ['sasjsadmin']
    }
  ],
  permissions: [
    {
      uid: 'rule-routes',
      path: '/SASjsApi/drive/file',
      type: 'Route',
      setting: 'Grant',
      group: 'group-data-controller'
    },
    {
      uid: 'rule-execute',
      path: '/SASjsApi/stp/execute',
      type: 'Route',
      setting: 'Grant',
      group: 'group-data-controller'
    },
    {
      uid: 'rule-code',
      path: '/SASjsApi/code/execute',
      type: 'Route',
      setting: 'Deny',
      user: 'user-restricted'
    }
  ],
  clients: [
    {
      clientId: 'web_app',
      clientSecret: 'web_app',
      accessTokenExpiration: SECONDS_IN_A_DAY,
      refreshTokenExpiration: SECONDS_IN_A_DAY * 30
    },
    {
      clientId: 'sasjs',
      clientSecret: 'sasjs',
      accessTokenExpiration: 3600,
      refreshTokenExpiration: SECONDS_IN_A_DAY
    }
  ]
}

/**
 * Parses a fixture a build wrote, refusing one this package cannot read.
 *
 * The checks name what is wrong and what to do about it: a fixture is hand-
 * editable, so "invalid identity" would send the reader to the type rather than
 * to the line.
 */
export const parseIdentity = (raw: unknown): IdentityFixture => {
  const fixture = raw as IdentityFixture

  if (!fixture || typeof fixture !== 'object')
    throw new Error('The identity fixture is not an object.')

  if (fixture.format !== IDENTITY_FORMAT)
    throw new Error(
      `The identity fixture states format ${String(fixture.format)}, and this build reads format ${IDENTITY_FORMAT}. Rebuild the site, or replace mock-identity.json with one this version wrote.`
    )

  for (const key of ['users', 'groups', 'permissions', 'clients'] as const)
    if (!Array.isArray(fixture[key]))
      throw new Error(`The identity fixture has no \`${key}\` array.`)

  for (const token of fixture.tokens || [])
    if (!token.accessToken || !token.refreshToken)
      throw new Error(
        `The identity fixture declares a half pair for ${token.username}/${token.clientId}: a seeded token needs both an accessToken and a refreshToken, because a token only authenticates while the subject's pair holds it.`
      )

  if (!fixture.users.some((user) => user.isAdmin))
    throw new Error(
      'The identity fixture declares no administrator: a demo with nobody able to administer it cannot exercise the admin routes.'
    )

  return fixture
}
