import { createSessionService } from '../src/session/service.js'
import {
  DEFAULT_SESSIONS,
  MemorySessionHost
} from '../src/session/memory-host.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import { DEFAULT_IDENTITY } from '../src/identity/fixture.js'

/**
 * The half of the session contract the document does not state.
 *
 * sasjs/server documents these four routes with a `200` and nothing else, so the
 * corpus cannot pin a refusal - `spec/corpus-parity.spec.ts` compares by status
 * and would call the case drift. The `401`, and the `404` that covers both "no
 * such session" and "not yours", live here until the routes carry their
 * `@Response` decorators upstream.
 */
const service = () =>
  createSessionService(
    new MemoryIdentityStore(DEFAULT_IDENTITY),
    new MemorySessionHost()
  )

const ADMIN = { userId: 'user-admin', clientId: 'web_app' }
const RESTRICTED = { userId: 'user-restricted', clientId: 'web_app' }

describe('the session service', () => {
  it('refuses a caller with no subject', async () => {
    await expect(service().summary(undefined, 'sess-admin')).rejects.toThrow(
      'Unauthorized'
    )
  })

  it("answers the same 404 for an unknown session and for someone else's", async () => {
    await expect(service().summary(ADMIN, 'sess-nope')).rejects.toThrow(
      'Session not found.'
    )
    await expect(service().summary(RESTRICTED, 'sess-admin')).rejects.toThrow(
      'Session not found.'
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

  it('compares uids, not usernames', async () => {
    // a host that recorded the owner's *username* is recording the wrong thing;
    // the account that holds it must still be refused, which is what a uid
    // comparison gives and a name comparison would not
    const byName = createSessionService(
      new MemoryIdentityStore(DEFAULT_IDENTITY),
      new MemorySessionHost({
        ...DEFAULT_SESSIONS,
        'sess-by-name': {
          owner: 'admin',
          summary: { sessionId: 'sess-by-name', state: 'completed' }
        }
      })
    )

    // a restricted user, so the administrator bypass cannot mask it
    await expect(byName.summary(RESTRICTED, 'sess-by-name')).rejects.toThrow(
      'Session not found.'
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

  it('answers 404 when the host loses the session between the record and the file', async () => {
    // the registry knows it, the run time no longer has a log or a state for it
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
      'Session not found.'
    )
    await expect(vanishing.output(ADMIN, 'sess-admin')).rejects.toThrow(
      'Session not found.'
    )
    await expect(vanishing.state(ADMIN, 'sess-admin')).rejects.toThrow(
      'Session not found.'
    )
  })
})
