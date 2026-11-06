/**
 * The sign-in service's own edges - the behaviour a corpus case cannot state in
 * one request: a code is spent once, an exchange reuses a live pair, a refresh
 * rotates the pair, and a fixture is refused by a name rather than a stack.
 */
import { createIdentityService } from '../src/identity/service.js'
import { createRecordService } from '../src/identity/records.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import {
  DEFAULT_IDENTITY,
  IDENTITY_FORMAT,
  parseIdentity
} from '../src/identity/fixture.js'
import { isApiError } from '../src/types.js'
import { SIGNED_IN } from '../src/corpus/identity.js'
import { ADMIN_SIGNED_IN } from '../src/corpus/records.js'

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

  it('issues a fresh pair when the saved pair has aged out', async () => {
    const identity = service()
    const subject = { userId: 'user-restricted', clientId: 'sasjs' }
    const clock = jest.spyOn(Date, 'now').mockReturnValue(2_000_000)

    try {
      const first = await identity.token({
        clientId: 'sasjs',
        code: await identity.authorize(subject, 'sasjs')
      })

      // the `sasjs` client's access token lives an hour: past that the saved
      // pair is still stored but its access half names nobody
      clock.mockReturnValue(2_000_000 + 3600 * 1000)

      const second = await identity.token({
        clientId: 'sasjs',
        code: await identity.authorize(subject, 'sasjs')
      })

      // handing the dead pair back would sign the caller in and then refuse
      // every request it makes, so the exchange mints a live one instead
      expect(second.accessToken).not.toEqual(first.accessToken)
      expect(await identity.authenticate(second.accessToken)).toEqual(subject)
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

  /**
   * A host with its own session - sasjs/server's browser cookie - resolves the
   * caller itself and passes the subject in, so these two paths never go through
   * `authenticate`. The corpus cannot reach them either: its cases name a token.
   */
  const inactiveStore = () =>
    new MemoryIdentityStore({
      ...SIGNED_IN,
      users: SIGNED_IN.users.map((user) =>
        user.username === 'user2' ? { ...user, isActive: false } : user
      )
    })

  it('refuses an authorization code to a host-resolved caller who was deactivated', async () => {
    const identity = createIdentityService(inactiveStore())

    expect(
      await failure(() =>
        identity.authorize(
          { userId: 'user-restricted', clientId: 'web_app' },
          'web_app'
        )
      )
    ).toEqual({ status: 401, message: 'Unauthorized' })
  })

  it('refuses the session read for a host-resolved caller who was deactivated', async () => {
    const identity = createIdentityService(inactiveStore())

    // the account is still there; it is the active flag that has changed, which
    // is what sasjs/server's middleware re-reads on every request
    expect(
      await failure(() =>
        identity.session({ userId: 'user-restricted', clientId: 'web_app' })
      )
    ).toEqual({ status: 401, message: 'Unauthorized' })
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

describe('what the store refuses', () => {
  it('refuses a fixture whose format this build does not read', () => {
    expect(
      () =>
        new MemoryIdentityStore({
          ...DEFAULT_IDENTITY,
          format: IDENTITY_FORMAT + 1
        })
    ).toThrow(/this store reads/)
  })

  it('refuses a seeded token that is only half a pair', () => {
    for (const half of [
      { username: 'admin', clientId: 'web_app', accessToken: 'only-this' },
      { username: 'admin', clientId: 'web_app', refreshToken: 'only-this' }
    ])
      expect(() =>
        parseIdentity({ ...DEFAULT_IDENTITY, tokens: [half] })
      ).toThrow(/half pair/)
  })

  it('refuses to mint an identity string when the host has no Web Crypto', async () => {
    const crypto = (globalThis as { crypto?: unknown }).crypto
    // a host without Web Crypto cannot mint an unguessable string, and a
    // guessable token is an authentication bypass rather than a demo quirk
    delete (globalThis as { crypto?: unknown }).crypto
    try {
      const store = new MemoryIdentityStore()
      expect(
        await failure(() =>
          store.issueCode({ userId: 'user-restricted', clientId: 'web_app' })
        )
      ).toEqual({
        status: 500,
        message:
          'This host has no Web Crypto (`globalThis.crypto`), so it cannot mint an unguessable identity string.'
      })
    } finally {
      ;(globalThis as { crypto?: unknown }).crypto = crypto
    }
  })
})

describe('the record service, where the store disagrees', () => {
  const caller = { userId: 'user-admin', clientId: 'web_app' }

  it('answers 400 when the store cannot add a member', async () => {
    const store = new MemoryIdentityStore({ ...ADMIN_SIGNED_IN })
    jest.spyOn(store, 'addToGroup').mockResolvedValue(undefined)
    const records = createRecordService(store)

    expect(
      await failure(() =>
        records.addUserToGroup(caller, 'group-admins', 'user-restricted')
      )
    ).toEqual({ status: 400, message: 'Unable to update group.' })
  })

  it('answers 404 when the store loses a user between the read and the write', async () => {
    const store = new MemoryIdentityStore({ ...ADMIN_SIGNED_IN })
    jest.spyOn(store, 'updateUser').mockResolvedValue(undefined)
    const records = createRecordService(store)

    expect(
      await failure(() =>
        records.updateUser(
          caller,
          { uid: 'user-restricted' },
          { displayName: 'Renamed', username: 'user2', password: 'user123' }
        )
      )
    ).toEqual({
      status: 404,
      message: 'Unable to find user with user-restricted'
    })
  })
})

describe('a password change', () => {
  it('clears the flag through the store, so a host stops asking', async () => {
    const store = new MemoryIdentityStore({ ...ADMIN_SIGNED_IN })
    const records = createRecordService(store)

    await records.updatePassword(
      { userId: 'user-restricted', clientId: 'web_app' },
      { currentPassword: 'user123', newPassword: 'changed123' }
    )

    // sasjs/server refuses every other call while this stands, so it has to reach
    // the store rather than a record the read happened to return
    expect(
      (await store.userById('user-restricted'))?.needsToUpdatePassword
    ).toBe(false)
    expect(
      await store.passwordMatches(
        (await store.userById('user-restricted'))!,
        'changed123'
      )
    ).toBe(true)
  })
})
