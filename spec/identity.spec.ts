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

  it('does not spend a code whose client has been deleted', async () => {
    const store = new MemoryIdentityStore({ ...SIGNED_IN })
    const identity = createIdentityService(store)
    const spent = jest.spyOn(store, 'claimCode')

    expect(
      await failure(() =>
        identity.token({ clientId: 'removed_client', code: 'seed-orphan-code' })
      )
    ).toEqual({ status: 401, message: 'Invalid clientId.' })

    // refused on the client, before the code is reached: a caller that fixes
    // its clientId can still exchange the code it holds
    expect(spent).not.toHaveBeenCalled()
  })

  it('mints opaque strings that a reader cannot reproduce', async () => {
    const store = new MemoryIdentityStore({ ...SIGNED_IN })
    const client = (await store.client('sasjs'))!
    const subject = { userId: 'user-restricted', clientId: 'sasjs' }

    const one = await store.issue(subject, client)
    const two = await store.issue(subject, client)

    // a counter or a Math.random() suffix would make both a sequence and a
    // guess: the strings come from the platform's cryptographic source
    expect(one.accessToken).toMatch(/^access-[0-9a-f]{32}$/)
    expect(one.refreshToken).toMatch(/^refresh-[0-9a-f]{32}$/)
    expect(two.accessToken).not.toEqual(one.accessToken)
  })

  it('stops authenticating a token once its client lifetime has passed', async () => {
    const store = new MemoryIdentityStore({ ...SIGNED_IN })
    const identity = createIdentityService(store)
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)

    try {
      // the `sasjs` client's access token lives an hour, its refresh token a day
      const issued = await identity.token({
        clientId: 'sasjs',
        code: await identity.authorize(
          { userId: 'user-restricted', clientId: 'sasjs' },
          'sasjs'
        )
      })

      clock.mockReturnValue(1_000_000 + 3600 * 1000 - 1)
      expect(await identity.authenticate(issued.accessToken)).toEqual({
        userId: 'user-restricted',
        clientId: 'sasjs'
      })

      clock.mockReturnValue(1_000_000 + 3600 * 1000 + 1)
      expect(await identity.authenticate(issued.accessToken)).toBeUndefined()

      // its refresh token outlives it, which is what makes a refresh useful
      clock.mockReturnValue(1_000_000 + 86400 * 1000 + 1)
      expect(
        await failure(() => identity.refresh(issued.refreshToken))
      ).toEqual({ status: 401, message: 'Unauthorized' })
    } finally {
      clock.mockRestore()
    }
  })

  it('refuses a code once its thirty seconds have passed', async () => {
    const store = new MemoryIdentityStore({ ...SIGNED_IN })
    const identity = createIdentityService(store)
    const clock = jest.spyOn(Date, 'now').mockReturnValue(2_000_000)

    try {
      const code = await identity.authorize(
        { userId: 'user-restricted', clientId: 'web_app' },
        'web_app'
      )

      clock.mockReturnValue(2_000_000 + 30 * 1000 + 1)
      expect(
        await failure(() => identity.token({ clientId: 'web_app', code }))
      ).toEqual({ status: 401, message: 'Invalid Auth Code' })
    } finally {
      clock.mockRestore()
    }
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

describe('deactivated accounts', () => {
  it('refuses the sign-in, and stops resolving a token it issued earlier', async () => {
    const identity = service()

    const issued = await identity.token({
      clientId: 'web_app',
      code: await identity.authorize(
        { userId: 'user-restricted', clientId: 'web_app' },
        'web_app'
      )
    })

    // the fixture is live at this point
    expect(await identity.authenticate(issued.accessToken)).toBeDefined()

    const deactivated = createIdentityService(
      new MemoryIdentityStore({
        ...SIGNED_IN,
        users: SIGNED_IN.users.map((user) =>
          user.username === 'user2' ? { ...user, isActive: false } : user
        )
      })
    )

    expect(
      await failure(() =>
        deactivated.login({ username: 'user2', password: 'user123' })
      )
    ).toEqual({ status: 401, message: 'This account is not active.' })
    expect(await deactivated.authenticate('seed-access')).toBeUndefined()
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

  it('refuses a half pair, saying why a token needs both halves', () => {
    expect(() =>
      parseIdentity({
        ...DEFAULT_IDENTITY,
        tokens: [{ username: 'user2', clientId: 'web_app', accessToken: 'a' }]
      })
    ).toThrow(/half pair for user2\/web_app/)
  })

  it('refuses a fixture missing a collection, naming it', () => {
    const { users: _users, ...rest } = DEFAULT_IDENTITY
    expect(() => parseIdentity(rest)).toThrow(/no `users` array/)
  })
})
