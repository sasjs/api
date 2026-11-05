/**
 * The sign-in service's own edges - the behaviour a corpus case cannot state in
 * one request: a code is spent once, an exchange reuses a live pair, a refresh
 * rotates the pair, and a fixture is refused by a name rather than a stack.
 */
import { createIdentityService } from '../src/identity/service.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import {
  DEFAULT_IDENTITY,
  IDENTITY_FORMAT,
  parseIdentity
} from '../src/identity/fixture.js'
import { isApiError } from '../src/types.js'
import { SIGNED_IN } from '../src/corpus/identity.js'

const failure = async (run: () => Promise<unknown>) => {
  try {
    await run()
    return 'resolved'
  } catch (error) {
    return isApiError(error)
      ? { status: error.status, message: error.message }
      : String(error)
  }
}

const service = () =>
  createIdentityService(new MemoryIdentityStore({ ...SIGNED_IN }))

describe('identity service', () => {
  it('spends an authorization code once', async () => {
    const identity = service()
    const issued = await identity.authorize(
      { userId: 'user-restricted', clientId: 'web_app' },
      'web_app'
    )

    const first = await identity.token({ clientId: 'web_app', code: issued })
    expect(first).toHaveProperty('accessToken')

    // the second exchange of the same code is refused, even though a pair now
    // exists: a code is the credential, and a spent one buys nothing
    expect(
      await failure(() => identity.token({ clientId: 'web_app', code: issued }))
    ).toEqual({ status: 401, message: 'Invalid Auth Code' })
  })

  it('does not spend a code presented for another client', async () => {
    const identity = service()
    const issued = await identity.authorize(
      { userId: 'user-restricted', clientId: 'web_app' },
      'web_app'
    )

    expect(
      await failure(() => identity.token({ clientId: 'sasjs', code: issued }))
    ).toEqual({ status: 401, message: 'Invalid Auth Code' })

    // the right client can still exchange it
    expect(
      await identity.token({ clientId: 'web_app', code: issued })
    ).toHaveProperty('accessToken')
  })

  it('re-exchanging a fresh code returns the live pair', async () => {
    const identity = service()
    const subject = { userId: 'user-restricted', clientId: 'web_app' }
    const first = await identity.authorize(subject, 'web_app')
    const one = await identity.token({ clientId: 'web_app', code: first })

    const second = await identity.authorize(subject, 'web_app')
    const two = await identity.token({ clientId: 'web_app', code: second })

    // another tab holding the first pair must not be signed out by a second
    // exchange
    expect(two).toEqual(one)
  })

  it('rotates the pair on refresh', async () => {
    const identity = service()
    const subject = { userId: 'user-restricted', clientId: 'web_app' }
    const issued = await identity.token({
      clientId: 'web_app',
      code: (await identity.authorize(subject, 'web_app')) as string
    })

    const rotated = await identity.refresh(issued.refreshToken)

    expect(rotated.refreshToken).not.toEqual(issued.refreshToken)
    // the previous refresh token is spent: it names a pair the subject no longer
    // holds, which is the same check sasjs/server makes against its database
    expect(await failure(() => identity.refresh(issued.refreshToken))).toEqual({
      status: 401,
      message: 'Unauthorized'
    })
  })

  it('stops authenticating a token once the pair is revoked', async () => {
    const identity = service()
    const subject = { userId: 'user-restricted', clientId: 'web_app' }

    // the fixture declares a live pair for the seeded tokens, the way a host
    // starts with a session it issued earlier
    expect(await identity.authenticate('seed-access')).toEqual(subject)

    await identity.logout(subject)

    const caller = await identity.authenticate('seed-access')
    expect(caller).toBeUndefined()
    // a host passes the caller it resolved; none resolves from a revoked token
    expect(await failure(() => identity.session(caller))).toEqual({
      status: 401,
      message: 'Unauthorized'
    })
  })
})

describe('identity fixture', () => {
  it('reads the default fixture', () => {
    expect(parseIdentity(DEFAULT_IDENTITY)).toBe(DEFAULT_IDENTITY)
  })

  it('refuses a fixture from another format, naming both', () => {
    expect(() =>
      parseIdentity({ ...DEFAULT_IDENTITY, format: IDENTITY_FORMAT + 1 })
    ).toThrow(/format 2.*reads format 1/)
  })

  it('refuses a fixture with no administrator, saying why it matters', () => {
    expect(() =>
      parseIdentity({
        ...DEFAULT_IDENTITY,
        users: DEFAULT_IDENTITY.users.map((user) => ({
          ...user,
          isAdmin: false
        }))
      })
    ).toThrow(/no administrator/)
  })

  it('refuses a fixture missing a collection, naming it', () => {
    const { users: _users, ...rest } = DEFAULT_IDENTITY
    expect(() => parseIdentity(rest)).toThrow(/no `users` array/)
  })
})
