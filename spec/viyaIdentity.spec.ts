import { dispatchViya } from '../src/viya/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { createIdentityService } from '../src/identity/service.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import { createRecordService } from '../src/identity/records.js'
import { DEFAULT_IDENTITY } from '../src/identity/fixture.js'
import { EMULATED_CONTEXT_ID } from '../src/viya/compute.js'
import type { Services } from '../src/host/dispatch.js'
import type { Subject } from '../src/identity/types.js'

/**
 * The identity reads an application makes for itself.
 *
 * These are the calls the adapter never makes, so no capture describes them and
 * no recorded shape can be walked. What the emulator owes them instead is the
 * behaviour a screen depends on: the groups the estate holds, the caller's own
 * memberships, a group's members, an account by id, and the refusals - an unknown
 * id, a caller with no session, a host with no records service.
 */
const caller: Subject = { userId: 'user-admin', clientId: 'client' }

const services = (): Services => {
  const store = new MemoryIdentityStore(DEFAULT_IDENTITY)

  return {
    drive: createDriveService(new MemoryDriveStore()),
    identity: createIdentityService(store),
    records: createRecordService(store)
  }
}

/**
 * A GET, with the query parsed the way a host parses it.
 *
 * The hosts hand the dispatcher a `query` object; the path is matched without
 * one. Parsing it here keeps a case readable as the URL a screen builds, which is
 * the thing being answered.
 */
const get = (shared: Services, path: string, subject?: Subject) => {
  const [route, search = ''] = path.split('?')

  return dispatchViya(shared, 'GET', route, {
    query: Object.fromEntries(new URLSearchParams(search)),
    subject
  })
}

describe('the emulated identity service', () => {
  it('lists the estate groups, sorted by name when asked', async () => {
    const answer = await get(
      services(),
      '/identities/groups?sortBy=name&limit=5000',
      caller
    )

    expect(answer.status).toBe(200)

    const body = answer.body as {
      count: number
      items: Array<{ name: string }>
    }

    // the fixture's two groups, in name order: Admins, DCGroup - which is not the
    // order the fixture lists them in
    expect(body.items.map((item) => item.name)).toEqual(['Admins', 'DCGroup'])
    expect(body.count).toBe(2)
  })

  it('carries the member count a screen shows beside a group', async () => {
    const answer = await get(services(), '/identities/groups', caller)

    const body = answer.body as {
      items: Array<{ id: string; name: string; memberCount: number }>
    }

    const admins = body.items.find((item) => item.name === 'Admins')

    expect(admins?.memberCount).toBe(1)
  })

  it('honours the limit a client asks for', async () => {
    const answer = await get(services(), '/identities/groups?limit=1', caller)

    const body = answer.body as { count: number; limit: number }

    expect(body.count).toBe(1)
    // the value asked for is echoed, so a client that asked for one and got one
    // can tell the estate had more
    expect(body.limit).toBe(1)
  })

  it('lists the members of a group', async () => {
    const answer = await get(
      services(),
      '/identities/groups/group-admins/members?limit=2000',
      caller
    )

    expect(answer.status).toBe(200)

    const body = answer.body as {
      items: Array<{ id: string; name: string }>
    }

    expect(body.items).toEqual([
      expect.objectContaining({ id: 'user-admin', name: 'sasjsadmin' })
    ])
  })

  it('lists the accounts the estate holds', async () => {
    const answer = await get(services(), '/identities/users?limit=2000', caller)

    const body = answer.body as {
      items: Array<{ id: string; name: string }>
    }

    expect(body.items.map((item) => item.name)).toEqual([
      'sasjsadmin',
      'sasjsuser'
    ])
  })

  it('answers a list asked for with no paging at all', async () => {
    // a client may ask for everything: the envelope then reports the size it
    // sent rather than a zero limit a reader would take for an empty request
    const answer = await get(services(), '/identities/users', caller)

    const body = answer.body as { count: number; limit: number }

    expect(body.count).toBe(2)
    expect(body.limit).toBe(2)
  })

  it('reads one account from the id the list returned', async () => {
    const answer = await get(
      services(),
      '/identities/users/user-restricted',
      caller
    )

    expect(answer.status).toBe(200)
    expect(answer.body).toEqual(
      expect.objectContaining({ id: 'user-restricted', name: 'sasjsuser' })
    )
  })

  it('answers the caller memberships from the session, not from the path', async () => {
    const answer = await get(
      services(),
      '/identities/users/@currentUser/memberships?limit=2000',
      caller
    )

    const body = answer.body as { items: Array<{ id: string }> }

    expect(body.items.map((item) => item.id)).toEqual(['group-admins'])
  })

  it('answers any account memberships by id, which is the same question for one user', async () => {
    const answer = await get(
      services(),
      '/identities/users/user-restricted/memberships?limit=2000',
      caller
    )

    const body = answer.body as { items: Array<{ id: string }> }

    expect(body.items.map((item) => item.id)).toEqual(['group-data-controller'])
  })

  it('reads the caller from a bearer token when the host forwards one', async () => {
    // the server's Viya router passes a token rather than a resolved subject, so
    // the identity family reads it the same way `@currentUser` does. The token is
    // one the estate issued, because a token it did not issue is no caller at all
    const store = new MemoryIdentityStore({
      ...DEFAULT_IDENTITY,
      // a token the fixture already accepts, which is how a case starts signed
      // in without replaying the sign-in flow - both halves, because the store
      // treats a complete seeded pair as the subject's live pair, and that is
      // what makes it authenticate
      tokens: [
        {
          username: 'sasjsadmin',
          clientId: 'web_app',
          accessToken: 'seeded',
          refreshToken: 'seeded-refresh'
        }
      ]
    })
    const shared: Services = {
      drive: createDriveService(new MemoryDriveStore()),
      identity: createIdentityService(store),
      records: createRecordService(store)
    }
    const token = 'seeded'

    const answer = await dispatchViya(
      shared,
      'GET',
      '/identities/users/@currentUser/memberships',
      { query: {}, token }
    )

    expect(answer.status).toBe(200)
    expect((answer.body as { count: number }).count).toBe(1)
  })

  it('refuses a token the estate never issued', async () => {
    const answer = await dispatchViya(
      services(),
      'GET',
      '/identities/users/@currentUser/memberships',
      { query: {}, token: 'not-a-token' }
    )

    expect(answer.status).toBe(401)
  })

  it('answers an account memberships with no paging at all', async () => {
    const answer = await get(
      services(),
      '/identities/users/user-restricted/memberships',
      caller
    )

    const body = answer.body as { count: number; limit: number }

    expect(body.count).toBe(1)
    expect(body.limit).toBe(1)
  })

  it('refuses a caller with no session rather than answering an empty list', async () => {
    // an empty list would read as an estate with no groups, which is a different
    // fact from "nobody is signed in"
    const answer = await get(services(), '/identities/groups')

    expect(answer.status).toBe(401)
  })

  it('answers 404 for a group the estate does not have', async () => {
    const answer = await get(
      services(),
      '/identities/groups/no-such-group/members',
      caller
    )

    expect(answer.status).toBe(404)
  })

  it('answers 404 for an avatar, which the estate identity does not carry', async () => {
    const answer = await get(
      services(),
      '/identities/users/user-admin/avatar/content',
      caller
    )

    expect(answer.status).toBe(404)
  })

  it('names the capability when the host supplies no records service', async () => {
    const shared = services()
    delete (shared as { records?: unknown }).records

    const answer = await get(shared, '/identities/groups', caller)

    expect(answer.status).toBe(501)
    expect(JSON.stringify(answer.body)).toContain('records service')
  })

  it('stamps every answer as emulated, refusals included', async () => {
    for (const path of [
      '/identities/groups',
      '/identities/users/nobody',
      '/identities/users/user-admin/avatar/content'
    ]) {
      const answer = await get(services(), path, caller)

      expect(answer.headers['x-sasjs-emulated']).toBeDefined()
    }
  })
})

describe('the emulated compute context', () => {
  it('reads one context in full, with the attributes a deploy screen filters on', async () => {
    const answer = await get(
      services(),
      `/compute/contexts/${EMULATED_CONTEXT_ID}`,
      caller
    )

    expect(answer.status).toBe(200)
    expect(answer.body).toEqual(
      expect.objectContaining({
        id: EMULATED_CONTEXT_ID,
        attributes: expect.objectContaining({
          // nothing runs as a batch identity on an emulated estate, and saying so
          // is what keeps a client's batch-id list empty rather than invented
          reuseServerProcesses: 'false'
        })
      })
    )
  })

  it('answers 404 for a context id the estate does not have', async () => {
    const answer = await get(
      services(),
      '/compute/contexts/not-a-context',
      caller
    )

    expect(answer.status).toBe(404)
  })
})
