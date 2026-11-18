/**
 * The sign-in service's own edges - the behaviour a corpus case cannot state in
 * one request: a code is spent once, an exchange reuses a live pair, a refresh
 * rotates the pair, and a fixture is refused by a name rather than a stack.
 */
import { createIdentityService } from '../src/identity/service.js'
import { createDirectoryService } from '../src/directory/service.js'
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
          user.username === 'sasjsuser' ? { ...user, isActive: false } : user
        )
      })
    )

    expect(
      await failure(() =>
        deactivated.login({ username: 'sasjsuser', password: 'Orion123' })
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
        user.username === 'sasjsuser' ? { ...user, isActive: false } : user
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
        tokens: [
          { username: 'sasjsuser', clientId: 'web_app', accessToken: 'a' }
        ]
      })
    ).toThrow(/half pair for sasjsuser\/web_app/)
  })

  it('refuses a fixture missing a collection, naming it', () => {
    const { users: _users, ...rest } = DEFAULT_IDENTITY
    expect(() => parseIdentity(rest)).toThrow(/no `users` array/)
  })
})

describe('the store snapshot', () => {
  const store = () => new MemoryIdentityStore({ ...DEFAULT_IDENTITY })

  it('carries what a seed needs, passwords included', async () => {
    const source = store()
    const created = await source.createUser({
      username: 'newcomer',
      displayName: 'New Comer',
      isAdmin: false,
      isActive: true
    })
    await source.setPassword(created.uid, 'Password123')

    const snapshot = source.snapshot()
    expect(snapshot.format).toBe(IDENTITY_FORMAT)
    // a fixture is a seed: it has to be readable by the parser that reads one
    expect(parseIdentity(snapshot)).toBe(snapshot)

    const restored = new MemoryIdentityStore(snapshot)
    const identity = createIdentityService(restored)
    const signedIn = await identity.login({
      username: 'newcomer',
      password: 'Password123'
    })
    expect(signedIn.user.username).toBe('newcomer')
  })

  it('carries accounts, groups, rules and clients a session created', async () => {
    const source = store()
    const group = await source.createGroup({
      name: 'Reviewers',
      description: 'Read-only visitors',
      isActive: true
    })
    await source.createPermission({
      path: '/SASjsApi/drive',
      type: 'Route',
      setting: 'Deny',
      group: group.uid
    })
    await source.createClient({
      clientId: 'harness',
      clientSecret: 'secret',
      accessTokenExpiration: 600,
      refreshTokenExpiration: 3600
    })

    const restored = new MemoryIdentityStore(source.snapshot())
    const groups = await restored.groups()
    const permissions = await restored.permissions()
    const clients = await restored.clients()
    expect(groups.map((entry) => entry.name)).toContain('Reviewers')
    expect(permissions.map((entry) => entry.path)).toContain('/SASjsApi/drive')
    // the fixture states an assignment by uid, which is what the seed resolves:
    // a name here reloads as a rule assigned to nobody
    expect(
      permissions.find((entry) => entry.path === '/SASjsApi/drive')?.group
    ).toBe(group.uid)
    expect(clients.map((entry) => entry.clientId)).toContain('harness')
  })

  it('keeps a group membership the session created', async () => {
    const source = store()
    const created = await source.createUser({
      username: 'newcomer',
      displayName: 'New Comer',
      isAdmin: false,
      isActive: true
    })
    const group = await source.createGroup({
      name: 'Reviewers',
      description: 'Read-only visitors',
      isActive: true
    })
    await source.addToGroup(group.uid, created.uid)
    await source.setPassword(created.uid, 'Password123')

    const snapshot = source.snapshot()
    // the fixture states members by username, which is what a seed resolves;
    // writing the store's uids here would restore an empty group
    const shipped = snapshot.groups.find((entry) => entry.name === 'Reviewers')
    expect(shipped?.users).toEqual(['newcomer'])

    const restored = new MemoryIdentityStore(snapshot)
    const users = await restored.users()
    expect(
      users.find((entry) => entry.username === 'newcomer')?.groups
    ).toContain(group.uid)
  })

  it('states an account with no password without inventing one', async () => {
    const source = store()
    const created = await source.createUser({
      username: 'nominal',
      displayName: 'Nominal',
      isAdmin: false,
      isActive: true
    })

    const shipped = source
      .snapshot()
      .users.find((entry) => entry.username === 'nominal')
    // absent, not '': the restored store compares with equality, so an empty
    // string would be a password it accepted, and this account has none
    expect(shipped && 'password' in shipped).toBe(false)

    const restored = new MemoryIdentityStore(source.snapshot())
    expect(await restored.passwordMatches(created, '')).toBe(false)
  })

  it('carries an account a directory imported, which has no local password', async () => {
    const source = store()
    await createDirectoryService(source, {
      users: async () => [{ username: 'fromldap', displayName: 'From LDAP' }],
      groups: async () => []
    }).synchronise()

    const restored = new MemoryIdentityStore(source.snapshot())
    const imported = (await restored.users()).find(
      (entry) => entry.username === 'fromldap'
    )
    // an import leaves the password to the provider, so a snapshot that refused
    // this account would lose every write once a sync had run, and one that
    // wrote '' would hand it an empty credential
    expect(imported?.authProvider).toBe('ldap')
    if (!imported) throw new Error('the imported account did not survive')

    expect(await restored.passwordMatches(imported, '')).toBe(false)
  })

  it('leaves out a membership that names no account', async () => {
    const source = store()
    const group = await source.createGroup({
      name: 'Reviewers',
      description: 'Read-only visitors',
      isActive: true
    })
    // `addToGroup` records the uid it is handed without checking an account
    // answers to it, and the fixture states members by username, so a uid that
    // resolves to nobody would seed a member no reader can find
    await source.addToGroup(group.uid, 'user-missing')

    const shipped = source
      .snapshot()
      .groups.find((entry) => entry.name === 'Reviewers')
    expect(shipped?.users).toEqual([])
  })

  it('is a copy, so editing it does not edit the store', async () => {
    const source = store()
    const snapshot = source.snapshot()
    snapshot.users[0].displayName = 'Renamed'
    snapshot.users.push({
      uid: 'user-planted',
      username: 'planted',
      displayName: 'Planted',
      password: 'Password123',
      isAdmin: false,
      isActive: true,
      needsToUpdatePassword: false
    })
    // groups, permissions and clients are spread shallow, so a shared array or
    // row would let an edit here change the store it was read from
    snapshot.groups[0].users.push('planted-member')
    snapshot.permissions[0].path = '/planted'
    snapshot.clients[0].clientSecret = 'planted'

    const users = await source.users()
    expect(users.map((entry) => entry.username)).not.toContain('planted')
    expect(users[0].displayName).not.toBe('Renamed')

    const groups = await source.groups()
    expect(groups[0].users).not.toContain('planted-member')

    const permissions = await source.permissions()
    expect(permissions[0].path).not.toBe('/planted')

    const clients = await source.clients()
    expect(clients[0].clientSecret).not.toBe('planted')
  })

  it('leaves out tokens and codes: a persisted credential outlives its pair', async () => {
    const snapshot = store().snapshot()
    expect(snapshot.tokens).toBeUndefined()
    expect(snapshot.codes).toBeUndefined()
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
      { username: 'sasjsadmin', clientId: 'web_app', accessToken: 'only-this' },
      { username: 'sasjsadmin', clientId: 'web_app', refreshToken: 'only-this' }
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

  it('keeps an empty description as sent, rather than defaulting it', async () => {
    // the route refuses an empty description before it reaches here, so the
    // difference between `??` and `||` is only observable through the service: the
    // model's default applies to an absent field, not to an empty string
    const store = new MemoryIdentityStore({ ...ADMIN_SIGNED_IN })
    const records = createRecordService(store)

    expect(
      (
        await records.createGroup(caller, {
          name: 'EmptyDescription',
          description: ''
        })
      ).description
    ).toBe('')
  })

  it('refuses a non-admin acting on another account, at the service', async () => {
    // the routes gate this before the service is reached, so the service's own
    // refusal is exercised here rather than through a request
    const store = new MemoryIdentityStore({ ...ADMIN_SIGNED_IN })
    const records = createRecordService(store)
    const restricted = { userId: 'user-restricted', clientId: 'web_app' }

    expect(
      await failure(() =>
        records.updateUser(
          restricted,
          { uid: 'user-admin' },
          { displayName: 'Renamed User' }
        )
      )
    ).toEqual({ status: 401, message: 'Admin account required' })
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
          {
            displayName: 'Renamed',
            username: 'sasjsuser',
            password: 'Orion123'
          }
        )
      )
    ).toEqual({
      status: 404,
      message: 'Unable to find user with user-restricted'
    })
  })
})

describe('the transport gates', () => {
  const ADMIN = { userId: 'user-admin', clientId: 'web_app' }
  const RESTRICTED = { userId: 'user-restricted', clientId: 'web_app' }

  /** The default fixture, with one rule added to it. */
  const withRule = (
    rule: (typeof DEFAULT_IDENTITY)['permissions'][number]
  ): typeof DEFAULT_IDENTITY => ({
    ...DEFAULT_IDENTITY,
    permissions: [...DEFAULT_IDENTITY.permissions, rule]
  })

  const serviceFor = (fixture: typeof DEFAULT_IDENTITY = DEFAULT_IDENTITY) => {
    const store = new MemoryIdentityStore({ ...fixture })
    return { store, records: createRecordService(store) }
  }

  it('answers the administrator question without throwing', async () => {
    const { records } = serviceFor()

    expect(await records.mayAdminister(ADMIN)).toBe(true)
    expect(await records.mayAdminister(RESTRICTED)).toBe(false)
    expect(await records.mayAdminister(undefined)).toBe(false)

    // a live account either way, so only the admin answer differs
    expect(await records.mayAct(ADMIN)).toBe(true)
    expect(await records.mayAct(RESTRICTED)).toBe(true)
    expect(await records.mayAct(undefined)).toBe(false)
  })

  it('refuses a caller whose account was deactivated', async () => {
    const fixture = {
      ...DEFAULT_IDENTITY,
      users: DEFAULT_IDENTITY.users.map((user) =>
        user.uid === 'user-restricted' ? { ...user, isActive: false } : user
      )
    }
    const { records } = serviceFor(fixture)

    expect(await records.mayAdminister(RESTRICTED)).toBe(false)
    expect(await records.mayAct(RESTRICTED)).toBe(false)
    expect(await records.mayUseRoute(RESTRICTED, '/SASjsApi/stp/execute')).toBe(
      false
    )
  })

  it('decides a route by the rules the interface reads', async () => {
    const { records } = serviceFor()

    // an administrator holds everything, the rules do not apply
    expect(await records.mayUseRoute(ADMIN, '/SASjsApi/code/execute')).toBe(
      true
    )

    // the group grant on stp/execute, and the user's deny on code/execute
    expect(await records.mayUseRoute(RESTRICTED, '/SASjsApi/stp/execute')).toBe(
      true
    )
    expect(
      await records.mayUseRoute(RESTRICTED, '/SASjsApi/code/execute')
    ).toBe(false)

    // no rule at all reaches this one, so it is refused rather than assumed
    expect(
      await records.mayUseRoute(RESTRICTED, '/SASjsApi/drive/deploy')
    ).toBe(false)
    expect(await records.mayUseRoute(undefined, '/SASjsApi/drive/file')).toBe(
      false
    )

    // an administrator holds a route the inventory does not list at all, which is
    // what a host gating an operation of its own needs
    expect(await records.mayUseRoute(ADMIN, '/SASjsApi/session/x/output')).toBe(
      true
    )
    expect(
      await records.mayUseRoute(RESTRICTED, '/SASjsApi/session/x/output')
    ).toBe(false)
  })

  it('answers exactly the list `myAuthorizedRoutes` reports', async () => {
    const fixture = withRule({
      uid: 'rule-deploy',
      path: '/SASjsApi/drive/deploy',
      type: 'Route',
      setting: 'Grant',
      group: 'group-data-controller'
    })
    const { records } = serviceFor(fixture)

    const reported = (await records.myAuthorizedRoutes(RESTRICTED)).paths

    // the deploy's own grant is on the list; the upload is not, because the server
    // decides the upload on its own path and a grant on the deploy does not carry
    // it. The two answers have to agree, so the gate refuses it as well.
    expect(reported).toContain('/SASjsApi/drive/deploy')
    expect(reported).not.toContain('/SASjsApi/drive/deploy/upload')
    expect(
      await records.mayUseRoute(RESTRICTED, '/SASjsApi/drive/deploy/upload')
    ).toBe(false)

    // and every path the interface offers is admitted by the gate
    for (const path of reported)
      expect(await records.mayUseRoute(RESTRICTED, path)).toBe(true)
  })

  it('admits a grant on the reserved public group to any caller', async () => {
    const fixture: typeof DEFAULT_IDENTITY = {
      ...DEFAULT_IDENTITY,
      groups: [
        ...DEFAULT_IDENTITY.groups,
        {
          uid: 'group-public',
          name: 'public',
          description: 'every caller',
          isActive: true,
          users: []
        }
      ],
      permissions: [
        ...DEFAULT_IDENTITY.permissions,
        {
          uid: 'rule-public',
          path: '/SASjsApi/drive/deploy',
          type: 'Route',
          setting: 'Grant',
          group: 'group-public'
        }
      ]
    }
    const { records } = serviceFor(fixture)

    expect(
      await records.mayUseRoute(RESTRICTED, '/SASjsApi/drive/deploy')
    ).toBe(true)
  })

  it('reads the groups table only when a rule names a group', async () => {
    // a store with user rules alone: the public-group lookup cannot change the
    // answer, so the gate does not pay for it
    const fixture: typeof DEFAULT_IDENTITY = {
      ...DEFAULT_IDENTITY,
      permissions: [
        {
          uid: 'rule-code-only',
          path: '/SASjsApi/code/execute',
          type: 'Route',
          setting: 'Deny',
          user: 'user-restricted'
        }
      ]
    }
    const { store, records } = serviceFor(fixture)
    const groups = jest.spyOn(store, 'groups')

    expect(
      await records.mayUseRoute(RESTRICTED, '/SASjsApi/code/execute')
    ).toBe(false)
    expect(groups).not.toHaveBeenCalled()
  })
})

describe('a password change', () => {
  it('clears the flag through the store, so a host stops asking', async () => {
    const store = new MemoryIdentityStore({ ...ADMIN_SIGNED_IN })
    const records = createRecordService(store)

    await records.updatePassword(
      { userId: 'user-restricted', clientId: 'web_app' },
      { currentPassword: 'Orion123', newPassword: 'changed123' }
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
