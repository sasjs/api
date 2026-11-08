import { createSessionService } from '../src/session/service.js'
import {
  DEFAULT_SESSIONS,
  MemorySessionHost
} from '../src/session/memory-host.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import { DEFAULT_IDENTITY } from '../src/identity/fixture.js'
import type { IdentityFixture } from '../src/identity/fixture.js'

/**
 * The half of the session contract the document does not state.
 *
 * The `401` and the `404` now have corpus cases, because sasjs/server#574
 * documents both. What stays here is what a corpus case cannot express: a
 * deactivated account, a host that recorded the owner by username, and a run
 * time that has lost a session the registry still lists - each needs a store or a
 * host built for it.
 */
const service = () =>
  createSessionService(
    new MemoryIdentityStore(DEFAULT_IDENTITY),
    new MemorySessionHost()
  )

const ADMIN = { userId: 'user-admin', clientId: 'web_app' }
const RESTRICTED = { userId: 'user-restricted', clientId: 'web_app' }

const notFound = (id: string) => `Session with ID '${id}' was not found.`

describe('the session service', () => {
  it('refuses a caller with no subject', async () => {
    await expect(service().summary(undefined, 'sess-admin')).rejects.toThrow(
      'Unauthorized'
    )
  })

  it('refuses a subject the store does not hold', async () => {
    await expect(
      service().summary(
        { userId: 'no-such-user', clientId: 'web_app' },
        'sess-admin'
      )
    ).rejects.toThrow('Unauthorized')
  })

  it('refuses a deactivated account, which is not the same as a bad token', async () => {
    // the token is still well formed and the account is still there: it has been
    // switched off, which is the branch a refactor of `visible()` would drop
    const dormant = {
      ...DEFAULT_IDENTITY,
      users: [
        ...DEFAULT_IDENTITY.users,
        {
          uid: 'user-dormant',
          username: 'dormant',
          displayName: 'Dormant User',
          password: 'dormant1',
          isAdmin: false,
          isActive: false,
          needsToUpdatePassword: false
        }
      ]
    } as IdentityFixture

    const closed = createSessionService(
      new MemoryIdentityStore(dormant),
      new MemorySessionHost({
        ...DEFAULT_SESSIONS,
        'sess-dormant': {
          owner: 'user-dormant',
          summary: { sessionId: 'sess-dormant', state: 'completed' }
        }
      })
    )

    await expect(
      closed.summary(
        { userId: 'user-dormant', clientId: 'web_app' },
        'sess-dormant'
      )
    ).rejects.toThrow('Unauthorized')
  })

  it("answers the same 404 for an unknown session and for someone else's", async () => {
    await expect(service().summary(ADMIN, 'sess-nope')).rejects.toThrow(
      notFound('sess-nope')
    )
    await expect(service().summary(RESTRICTED, 'sess-admin')).rejects.toThrow(
      notFound('sess-admin')
    )
  })

  it('lets an administrator read a session that is not theirs', async () => {
    const summary = await service().summary(ADMIN, 'sess-restricted')
    expect(summary.sessionId).toBe('sess-restricted')
    expect(summary.state).toBe('running')
  })

  it('answers an empty log for a session that has written nothing', async () => {
    // not a 404: the session exists, it simply has not produced anything yet
    await expect(service().log(ADMIN, 'sess-silent')).resolves.toBe('')
  })

  it('accepts a host that recorded the owner by username', async () => {
    // sasjs/server's own session records carry the owner's username, so a host
    // handing them straight through the port must not 404 the owner. `owner` is
    // a uid by preference, and a name is the fallback - not the other way round
    const byName = createSessionService(
      new MemoryIdentityStore(DEFAULT_IDENTITY),
      new MemorySessionHost({
        ...DEFAULT_SESSIONS,
        'sess-by-name': {
          owner: 'sasjsadmin',
          summary: { sessionId: 'sess-by-name', state: 'completed' }
        }
      })
    )

    await expect(byName.summary(ADMIN, 'sess-by-name')).resolves.toEqual({
      sessionId: 'sess-by-name',
      state: 'completed'
    })

    // and it is still the owner's session alone
    await expect(byName.summary(RESTRICTED, 'sess-by-name')).rejects.toThrow(
      notFound('sess-by-name')
    )
  })

  it('answers 404 when the run time has lost what the registry still lists', async () => {
    // a session being cleaned up mid-request: the registry knows it, the run
    // time no longer has a log, an output or a state for it
    const vanishing = createSessionService(
      new MemoryIdentityStore(DEFAULT_IDENTITY),
      {
        session: async (id: string) => DEFAULT_SESSIONS[id],
        state: async () => undefined,
        log: async () => undefined,
        output: async () => undefined
      }
    )

    await expect(vanishing.log(ADMIN, 'sess-admin')).rejects.toThrow(
      notFound('sess-admin')
    )
    await expect(vanishing.output(ADMIN, 'sess-admin')).rejects.toThrow(
      notFound('sess-admin')
    )
    await expect(vanishing.state(ADMIN, 'sess-admin')).rejects.toThrow(
      notFound('sess-admin')
    )
  })
})
