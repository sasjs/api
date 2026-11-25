import { dispatchViya } from '../src/viya/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { EMULATED_CONTEXT_ID } from '../src/viya/compute.js'
import { estateFor } from '../src/viya/sessions.js'
import { estateKeyOf, normaliseServerUrl, seedOf } from '../src/viya/seed.js'
import type { Services } from '../src/host/dispatch.js'
import type { Subject } from '../src/identity/types.js'

// Synthetic subjects exercise dispatch, not server authentication or SAS folders.
const alice: Subject = { userId: 'alice', clientId: 'web_app' }
const bob: Subject = { userId: 'bob', clientId: 'web_app' }
let serial = 0
const target = (): Services => ({
  drive: createDriveService(new MemoryDriveStore()),
  viya: {
    serverUrl: `http://owner-isolation-${serial++}.invalid`,
    execute: async () => ({
      log: 'alice secret log',
      webout: 'alice secret output'
    })
  }
})

const create = async (services: Services, subject?: Subject) => {
  const response = await dispatchViya(
    services,
    'POST',
    `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
    { subject }
  )
  expect(response.status).toBe(201)
  return response.body as { id: string; owner: string }
}

const submit = async (services: Services, id: string, subject?: Subject) => {
  const response = await dispatchViya(
    services,
    'POST',
    `/compute/sessions/${id}/jobs`,
    {
      subject,
      body: { code: 'alice secret program' }
    }
  )
  expect(response.status).toBe(201)
  // The synthetic engine resolves immediately; let the completion callback run.
  await Promise.resolve()
  return (response.body as { id: string }).id
}

const routes = [
  [
    'session state',
    'GET',
    (s: string, _j: string) => `/compute/sessions/${s}/state`
  ],
  ['submit', 'POST', (s: string, _j: string) => `/compute/sessions/${s}/jobs`],
  ['job', 'GET', (s: string, j: string) => `/compute/sessions/${s}/jobs/${j}`],
  [
    'job state',
    'GET',
    (s: string, j: string) => `/compute/sessions/${s}/jobs/${j}/state`
  ],
  [
    'job log',
    'GET',
    (s: string, j: string) => `/compute/sessions/${s}/jobs/${j}/log/content`
  ],
  [
    'webout',
    'GET',
    (s: string, _j: string) => `/compute/sessions/${s}/filerefs/_webout/content`
  ],
  ['delete', 'DELETE', (s: string, _j: string) => `/compute/sessions/${s}`]
] as const

describe('compute session ownership at the Viya dispatcher', () => {
  it.each(routes)(
    'denies another user %s without changing the owner session',
    async (_name, method, path) => {
      const services = target()
      const session = await create(services, alice)
      const job = await submit(services, session.id, alice)
      const denied = await dispatchViya(
        services,
        method,
        path(session.id, job),
        {
          subject: bob,
          body: { code: 'unauthorized' }
        }
      )
      expect(denied.status).toBe(404)
      expect((denied.body as { message: string }).message).toBe(
        `Session with ID '${session.id}' was not found.`
      )
      expect(
        (
          await dispatchViya(
            services,
            'GET',
            `/compute/sessions/${session.id}/state`,
            { subject: alice }
          )
        ).status
      ).toBe(200)
      const log = await dispatchViya(
        services,
        'GET',
        `/compute/sessions/${session.id}/jobs/${job}/log/content`,
        { subject: alice }
      )
      expect(JSON.stringify(log.body)).toContain('alice secret log')
      const output = await dispatchViya(
        services,
        'GET',
        `/compute/sessions/${session.id}/filerefs/_webout/content`,
        { subject: alice }
      )
      expect(output.contents).toBe('alice secret output')
    }
  )

  it('permits the same user across client IDs and retains the wire bodies', async () => {
    const services = target()
    const session = await create(services, alice)
    expect(session.owner).toBe('alice')
    const anotherClient = { userId: 'alice', clientId: 'other' }
    const job = await submit(services, session.id, anotherClient)
    for (const [_name, method, path] of routes.slice(0, -1)) {
      const result = await dispatchViya(
        services,
        method,
        path(session.id, job),
        { subject: anotherClient, body: { code: 'ok' } }
      )
      expect(result.status).toBe(method === 'POST' ? 201 : 200)
    }
    expect(
      (
        await dispatchViya(
          services,
          'DELETE',
          `/compute/sessions/${session.id}`,
          { subject: anotherClient }
        )
      ).status
    ).toBe(204)
  })

  it('isolates anonymous mock sessions from authenticated users including the fallback name', async () => {
    const services = target()
    const anonymous = await create(services)
    expect(anonymous.owner).toBe('emulated-user')
    const authenticated = await create(services, alice)
    const fallbackName = { userId: 'emulated-user', clientId: 'web_app' }
    expect(
      (
        await dispatchViya(
          services,
          'GET',
          `/compute/sessions/${anonymous.id}/state`
        )
      ).status
    ).toBe(200)
    expect(
      (
        await dispatchViya(
          services,
          'GET',
          `/compute/sessions/${anonymous.id}/state`,
          { subject: fallbackName }
        )
      ).status
    ).toBe(404)
    expect(
      (
        await dispatchViya(
          services,
          'GET',
          `/compute/sessions/${authenticated.id}/state`
        )
      ).status
    ).toBe(404)
  })

  it('binds sessions to the stable account across username changes without changing the wire owner', async () => {
    const services = target()
    const original = { ...alice, ownerId: 'account-1' }
    const renamed = { ...original, userId: 'alicia', clientId: 'other' }
    const reused = { ...alice, ownerId: 'account-2' }
    const session = await create(services, original)
    expect(session.owner).toBe('alice')

    const path = `/compute/sessions/${session.id}/state`
    expect(
      (await dispatchViya(services, 'GET', path, { subject: renamed })).status
    ).toBe(200)
    expect(
      (await dispatchViya(services, 'GET', path, { subject: reused })).status
    ).toBe(404)
    const legacy = { ...alice, userId: original.ownerId }
    expect(
      (await dispatchViya(services, 'GET', path, { subject: legacy })).status
    ).toBe(404)
    expect((await create(services, renamed)).owner).toBe('alicia')
  })

  it('rejects an explicitly invalid stable account ID', async () => {
    const services = target()
    const subject = { ...alice, ownerId: ' ' }
    const response = await dispatchViya(
      services,
      'POST',
      `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
      { subject }
    )
    expect(response.status).toBe(401)
  })

  it('fails closed for an existing ownerless session', async () => {
    const services = target()
    const session = await create(services, alice)
    const record = estateFor(
      estateKeyOf(services.viya),
      seedOf(services.viya)
    ).session(session.id) as unknown as Record<string, unknown>
    delete record.owner
    for (const subject of [alice, bob, undefined]) {
      expect(
        (
          await dispatchViya(
            services,
            'GET',
            `/compute/sessions/${session.id}/state`,
            { subject }
          )
        ).status
      ).toBe(404)
    }
  })

  it('rejects a malformed subject rather than treating it as the anonymous mock', async () => {
    const services = target()
    const malformed = { userId: '', clientId: 'web_app' }
    const response = await dispatchViya(
      services,
      'POST',
      `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
      { subject: malformed }
    )
    expect(response.status).toBe(401)
  })

  it.each(['unresolved', ''])(
    'rejects a supplied token (%j) without a resolved subject',
    async (token) => {
      const services = target()
      const response = await dispatchViya(
        services,
        'POST',
        `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
        { token }
      )
      expect(response.status).toBe(401)
      const anonymous = await create(services)
      expect(
        (
          await dispatchViya(
            services,
            'GET',
            `/compute/sessions/${anonymous.id}/state`,
            { token }
          )
        ).status
      ).toBe(401)
    }
  )

  it('leaves unimplemented session and job list routes unchanged', async () => {
    const services = target()
    const session = await create(services, alice)
    for (const path of [
      '/compute/sessions',
      `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
      `/compute/sessions/${session.id}`,
      `/compute/sessions/${session.id}/jobs`,
      `/compute/sessions/${session.id}/log`
    ]) {
      const owner = await dispatchViya(services, 'GET', path, {
        subject: alice
      })
      const other = await dispatchViya(services, 'GET', path, { subject: bob })
      expect([404, 501]).toContain(owner.status)
      expect(other.status).toBe(owner.status)
    }
  })
})

/**
 * Two addresses are two estates even when the 32-bit seed they digest to is
 * one number.
 *
 * `seedOf` folds the whole normalised address into 32 bits, so two distinct
 * serverUrls collide by construction every ~2^32 addresses - a pair found by
 * search, not invented: `http://viya7991.example.com` and
 * `http://viya93710.example.com` both seed to 3750293910. Before the estate
 * registry was keyed by the address, such a pair shared one session namespace:
 * the same user's session made at one address was visible from the other, so
 * owner isolation held per estate but not per address.
 *
 * The regression reads the same session ID from an estate it did not write to,
 * so it measures registry scoping rather than differences in ID generation.
 */
describe('the estate is the address, not the seed', () => {
  // a real collision of the 32-bit digest over normalised addresses
  const A = 'http://viya7991.example.com'
  const B = 'http://viya93710.example.com'

  const servicesAt = (serverUrl: string): Services => ({
    drive: createDriveService(new MemoryDriveStore()),
    viya: {
      serverUrl,
      execute: async () => ({
        log: 'alice secret log',
        webout: 'alice secret output'
      })
    }
  })

  // the pair must actually collide: the case pins the property, not the pair
  const colliding = (): { a: string; b: string } => {
    expect(seedOf({ serverUrl: A })).toBe(seedOf({ serverUrl: B }))
    expect(normaliseServerUrl(A)).not.toBe(normaliseServerUrl(B))
    return { a: A, b: B }
  }

  it('does not share sessions between two addresses that digest to one seed', async () => {
    const { a, b } = colliding()
    const at = servicesAt(a)
    const elsewhere = servicesAt(b)

    // the same user at both addresses
    const session = await create(at, alice)
    await submit(at, session.id, alice)

    // the other address shares the seed, so its estate is empty: the session
    // this user made at `a` must not be visible from `b` - not by state, not
    // by webout, not by deletion
    expect(
      (
        await dispatchViya(
          elsewhere,
          'GET',
          `/compute/sessions/${session.id}/state`,
          {
            subject: alice
          }
        )
      ).status
    ).toBe(404)
    expect(
      (
        await dispatchViya(
          elsewhere,
          'GET',
          `/compute/sessions/${session.id}/filerefs/_webout/content`,
          { subject: alice }
        )
      ).status
    ).toBe(404)
    expect(
      (
        await dispatchViya(
          elsewhere,
          'DELETE',
          `/compute/sessions/${session.id}`,
          {
            subject: alice
          }
        )
      ).status
    ).toBe(404)

    // and the owner's own address still answers, so this is scoping, not loss
    expect(
      (
        await dispatchViya(at, 'GET', `/compute/sessions/${session.id}/state`, {
          subject: alice
        })
      ).status
    ).toBe(200)
  })

  it('does not let a job made at one address answer from the other', async () => {
    const { a, b } = colliding()
    const at = servicesAt(a)
    const elsewhere = servicesAt(b)

    const session = await create(at, alice)
    const job = await submit(at, session.id, alice)

    for (const [, method, path] of routes.slice(0, -1) as unknown as Array<
      [string, string, (s: string, j: string) => string]
    >) {
      const answer = await dispatchViya(
        elsewhere,
        method,
        path(session.id, job),
        { subject: alice }
      )

      // every read answers the same 404 a missing session answers, because
      // the estate at `b` has no session with that id at all
      expect(answer.status).toBe(404)
      expect((answer.body as { message: string }).message).toBe(
        `Session with ID '${session.id}' was not found.`
      )
    }

    // the owner's address still reads the job and its log
    const log = await dispatchViya(
      at,
      'GET',
      `/compute/sessions/${session.id}/jobs/${job}/log/content`,
      { subject: alice }
    )
    expect(log.status).toBe(200)
    expect(JSON.stringify(log.body)).toContain('alice secret log')
  })

  it('shares one estate across spellings of one address', async () => {
    // the same address spelled differently is still one estate: sessions made
    // under one spelling are visible under the other, which is what makes two
    // targets at one address agree
    const first = servicesAt(`${A}/SASDrive/`)
    const second = servicesAt(A.replace('http://', 'HTTP://'))

    const session = await create(first, alice)
    await submit(first, session.id, alice)

    expect(
      (
        await dispatchViya(
          second,
          'GET',
          `/compute/sessions/${session.id}/state`,
          { subject: alice }
        )
      ).status
    ).toBe(200)
    expect(
      (
        await dispatchViya(
          second,
          'DELETE',
          `/compute/sessions/${session.id}`,
          { subject: alice }
        )
      ).status
    ).toBe(204)
  })
})
