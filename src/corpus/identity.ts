/**
 * The sign-in flow's conformance corpus.
 *
 * A case names an operation, the request a client would make, the identity the
 * host starts from, and the answer the caller expects. Where the answer carries
 * a value the host mints - a token, a code - the case states the properties
 * instead, because the value is the host's and asserting it would pin one host's
 * cryptography into the contract.
 */
import type { CorpusCase } from './drive.js'
import { DEFAULT_IDENTITY, type IdentityFixture } from '../identity/fixture.js'

/** The default fixture, plus a caller that is already signed in. */
export const SIGNED_IN: IdentityFixture = {
  ...DEFAULT_IDENTITY,
  tokens: [
    {
      username: 'user2',
      clientId: 'web_app',
      accessToken: 'seed-access',
      refreshToken: 'seed-refresh'
    },
    {
      username: 'admin',
      clientId: 'removed_client',
      accessToken: 'seed-access-orphan',
      refreshToken: 'seed-refresh-orphan'
    }
  ],
  codes: [
    { code: 'seed-code', username: 'user2', clientId: 'web_app' },
    { code: 'seed-orphan-code', username: 'user2', clientId: 'removed_client' },
    // the same shape with a pair already issued: the exchange must still refuse,
    // rather than handing back tokens that belong to a client that is gone
    {
      code: 'seed-orphan-pair-code',
      username: 'admin',
      clientId: 'removed_client'
    }
  ]
}

/** The same identity, with the restricted user switched off. */
export const DEACTIVATED: IdentityFixture = {
  ...SIGNED_IN,
  users: SIGNED_IN.users.map((user) =>
    user.username === 'user2' ? { ...user, isActive: false } : user
  )
}

/** The user the seeded session belongs to, without the host's own identifier. */
const user2 = {
  username: 'user2',
  displayName: 'Demo User',
  isAdmin: false,
  needsToUpdatePassword: false
}

export const IDENTITY_CORPUS: CorpusCase[] = [
  {
    id: 'login',
    route: 'POST /SASLogon/login',
    description: 'signs a seeded user in',
    request: { body: { username: 'admin', password: 'admin123' } },
    expect: {
      status: 200,
      partial: {
        loggedIn: true,
        user: {
          username: 'admin',
          displayName: 'Demo Admin',
          isAdmin: true,
          needsToUpdatePassword: false
        }
      }
    }
  },
  {
    id: 'login-missing-username',
    route: 'POST /SASLogon/login',
    description: 'refuses a sign-in with no username as 400, naming the field',
    request: { body: { password: 'admin123' } },
    expect: { status: 400, error: '"username" is required' }
  },
  {
    id: 'login-deactivated',
    route: 'POST /SASLogon/login',
    description: 'refuses a deactivated account, naming it',
    identity: DEACTIVATED,
    request: { body: { username: 'user2', password: 'user123' } },
    expect: { status: 401, error: 'This account is not active.' }
  },
  {
    id: 'login-wrong-password',
    route: 'POST /SASLogon/login',
    description: 'refuses a wrong password as 401, naming it',
    request: { body: { username: 'admin', password: 'wrong123' } },
    expect: { status: 401, error: 'Invalid Password.' }
  },
  {
    id: 'login-unknown-user',
    route: 'POST /SASLogon/login',
    description: 'refuses an unknown username as 401, naming it',
    request: { body: { username: 'nobody', password: 'admin123' } },
    expect: { status: 401, error: 'Username is not found.' }
  },
  {
    id: 'authorize',
    route: 'POST /SASLogon/authorize',
    description: 'issues a code to a signed-in caller',
    identity: SIGNED_IN,
    request: {
      token: 'seed-access',
      body: { clientId: 'web_app' }
    },
    expect: { status: 200, keys: ['code'] }
  },
  {
    id: 'authorize-missing-client',
    route: 'POST /SASLogon/authorize',
    description:
      'refuses an authorize with no clientId as 400, naming the field',
    identity: SIGNED_IN,
    request: { token: 'seed-access', body: {} },
    expect: { status: 400, error: '"clientId" is required' }
  },
  {
    id: 'authorize-without-session',
    route: 'POST /SASLogon/authorize',
    description: 'refuses with 401 when no caller is signed in',
    request: { body: { clientId: 'web_app' } },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'authorize-unknown-client',
    route: 'POST /SASLogon/authorize',
    description: 'refuses an unknown client with 403',
    identity: SIGNED_IN,
    request: { token: 'seed-access', body: { clientId: 'nope' } },
    expect: { status: 403, error: 'Invalid clientId.' }
  },
  {
    id: 'exchange-code',
    route: 'POST /SASjsApi/auth/token',
    description: 'exchanges a code for a token pair',
    identity: SIGNED_IN,
    request: { body: { clientId: 'web_app', code: 'seed-code' } },
    expect: { status: 200, keys: ['accessToken', 'refreshToken'] }
  },
  {
    id: 'exchange-missing-client',
    route: 'POST /SASjsApi/auth/token',
    description:
      'refuses an exchange with no clientId as 400, naming the field',
    identity: SIGNED_IN,
    request: { body: { code: 'seed-code' } },
    expect: { status: 400, error: '"clientId" is required' }
  },
  {
    id: 'exchange-code-unknown',
    route: 'POST /SASjsApi/auth/token',
    description: 'refuses a code the host never issued',
    request: { body: { clientId: 'web_app', code: 'not-a-code' } },
    expect: { status: 401, error: 'Invalid Auth Code' }
  },
  {
    id: 'exchange-code-other-client',
    route: 'POST /SASjsApi/auth/token',
    description: 'refuses a code presented for another client, as a bad code',
    identity: SIGNED_IN,
    request: { body: { clientId: 'sasjs', code: 'seed-code' } },
    expect: { status: 401, error: 'Invalid Auth Code' }
  },
  {
    id: 'exchange-code-client-gone',
    route: 'POST /SASjsApi/auth/token',
    description: 'refuses a valid code whose client no longer exists',
    identity: SIGNED_IN,
    request: { body: { clientId: 'removed_client', code: 'seed-orphan-code' } },
    expect: { status: 401, error: 'Invalid clientId.' }
  },
  {
    id: 'exchange-code-client-gone-with-pair',
    route: 'POST /SASjsApi/auth/token',
    description:
      'refuses an exchange whose client is gone even when a pair was issued before it was deleted',
    identity: SIGNED_IN,
    request: {
      body: { clientId: 'removed_client', code: 'seed-orphan-pair-code' }
    },
    expect: { status: 401, error: 'Invalid clientId.' }
  },
  {
    id: 'exchange-code-deactivated',
    route: 'POST /SASjsApi/auth/token',
    description: 'refuses an exchange for an account that has been deactivated',
    identity: DEACTIVATED,
    request: { body: { clientId: 'web_app', code: 'seed-code' } },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'refresh',
    route: 'POST /SASjsApi/auth/refresh',
    description: 'mints a new pair from a refresh token',
    identity: SIGNED_IN,
    request: { token: 'seed-refresh' },
    expect: { status: 200, keys: ['accessToken', 'refreshToken'] }
  },
  {
    id: 'refresh-invalid',
    route: 'POST /SASjsApi/auth/refresh',
    description: 'refuses a refresh token it did not issue',
    request: { token: 'not-a-token' },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'refresh-without-token',
    route: 'POST /SASjsApi/auth/refresh',
    description: 'refuses a refresh with no token at all',
    request: {},
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'refresh-client-gone',
    route: 'POST /SASjsApi/auth/refresh',
    description: 'refuses a refresh whose client no longer exists',
    identity: SIGNED_IN,
    request: { token: 'seed-refresh-orphan' },
    expect: { status: 401, error: 'Invalid clientId.' }
  },
  {
    id: 'refresh-deactivated',
    route: 'POST /SASjsApi/auth/refresh',
    description:
      'refuses a refresh for an account that has been deactivated, as the server does on every request',
    identity: DEACTIVATED,
    request: { token: 'seed-refresh' },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'logout',
    route: 'POST /SASjsApi/auth/logout',
    description: 'revokes the caller pair and answers 204',
    identity: SIGNED_IN,
    request: { token: 'seed-access' },
    expect: { status: 204 }
  },
  {
    id: 'logout-without-token',
    route: 'POST /SASjsApi/auth/logout',
    description: 'refuses a logout with no valid token',
    request: {},
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'session',
    route: 'GET /SASjsApi/session',
    description: 'reports the caller the token names',
    identity: SIGNED_IN,
    request: { token: 'seed-access' },
    expect: { status: 200, partial: user2 }
  },
  {
    id: 'session-deactivated',
    route: 'GET /SASjsApi/session',
    description: 'stops resolving a token whose account has been deactivated',
    identity: DEACTIVATED,
    request: { token: 'seed-access' },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'session-without-token',
    route: 'GET /SASjsApi/session',
    description: 'refuses the session read with no caller',
    request: {},
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'sign-out',
    route: 'GET /SASLogon/logout',
    description: 'answers the body the browser sign-out returns',
    request: {},
    expect: { status: 200, contents: 'OK!' }
  }
]
