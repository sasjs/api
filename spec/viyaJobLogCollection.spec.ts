import { dispatchViya } from '../src/viya/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { EMULATED_CONTEXT_ID } from '../src/viya/compute.js'
import { estateFor } from '../src/viya/sessions.js'
import { estateKeyOf, seedOf } from '../src/viya/seed.js'
import type { Services } from '../src/host/dispatch.js'

const lines = Array.from({ length: 21007 }, (_, i) => `mock line ${i}`)
const owner = { userId: 'alice', ownerId: 'account-alice', clientId: 'app' }

const setup = async () => {
  const services: Services = {
    drive: createDriveService(new MemoryDriveStore()),
    viya: {
      serverUrl: 'http://job-log-collection.invalid',
      execute: async () => ({ log: lines.join('\n') })
    }
  }
  const session = await dispatchViya(
    services,
    'POST',
    `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
    { subject: owner }
  )
  expect(session.status).toBe(201)
  const sessionId = (session.body as { id: string }).id
  const job = await dispatchViya(
    services,
    'POST',
    `/compute/sessions/${sessionId}/jobs`,
    { subject: owner, body: { code: 'mock input' } }
  )
  expect(job.status).toBe(201)
  await Promise.resolve()
  const jobId = (job.body as { id: string }).id
  return {
    services,
    sessionId,
    jobId,
    path: `/compute/sessions/${sessionId}/jobs/${jobId}/log`
  }
}

test('job log collection returns every host-provided line in order across offsets', async () => {
  const { services, path } = await setup()
  const all: string[] = []
  for (const start of [0, 10000, 20000, 30000]) {
    const result = await dispatchViya(services, 'GET', path, {
      subject: owner,
      query: { start: String(start), limit: '10000' }
    })
    expect(result.status).toBe(200)
    const body = result.body as {
      count: number
      start: number
      limit: number
      items: Array<{ line: string; type: string; version: number }>
      links: Array<{
        href: string
        uri: string
        rel: string
        type: string
        itemType: string
      }>
    }
    expect(body.links).toEqual([
      {
        href: path,
        uri: path,
        rel: 'self',
        method: 'GET',
        type: 'application/vnd.sas.collection',
        itemType: 'application/vnd.sas.compute.log.line'
      }
    ])
    expect(body).toEqual(
      expect.objectContaining({
        count: lines.length,
        start,
        limit: 10000,
        version: 2
      })
    )
    expect(body.items).toEqual(
      lines
        .slice(start, start + 10000)
        .map((line) => ({ line, type: 'NOTE', version: 2 }))
    )
    all.push(...body.items.map((item) => item.line))
  }
  expect(all).toEqual(lines)
  const content = await dispatchViya(services, 'GET', `${path}/content`, {
    subject: owner,
    query: { start: '10000', limit: '2' }
  })
  expect(
    (content.body as { items: Array<{ line: string }> }).items.map(
      (item) => item.line
    )
  ).toEqual(lines.slice(10000, 10002))
})

test('rejects malformed pagination instead of coercing it', async () => {
  const { services, path } = await setup()
  for (const value of [
    '',
    '-1',
    '1.5',
    '1e2',
    '9007199254740992',
    null,
    ['1']
  ]) {
    for (const key of ['start', 'limit']) {
      const query = { [key]: value } as unknown as Record<string, string>
      expect(
        (await dispatchViya(services, 'GET', path, { subject: owner, query }))
          .status
      ).toBe(400)
    }
  }
  expect(
    (
      await dispatchViya(services, 'GET', path, {
        subject: owner,
        query: { limit: '2147483648' }
      })
    ).status
  ).toBe(400)
})

test('refuses missing, foreign, deleted, and ownerless sessions and missing jobs', async () => {
  const { services, path, sessionId } = await setup()
  const missingJob = path.replace(/\/jobs\/[^/]+\/log$/, '/jobs/missing/log')
  const missingSession = path.replace(sessionId, 'missing')
  expect(
    (await dispatchViya(services, 'GET', missingJob, { subject: owner })).status
  ).toBe(404)
  expect(
    (await dispatchViya(services, 'GET', missingSession, { subject: owner }))
      .status
  ).toBe(404)
  const foreign = { ...owner, ownerId: 'account-bob' }
  const denied = await dispatchViya(services, 'GET', path, {
    subject: foreign,
    query: { start: '-1' }
  })
  expect(denied.status).toBe(404)
  expect((denied.body as { message: string }).message).toBe(
    `Session with ID '${sessionId}' was not found.`
  )
  expect(
    (await dispatchViya(services, 'GET', path, { token: 'unresolved' })).status
  ).toBe(401)
  const estate = estateFor(estateKeyOf(services.viya), seedOf(services.viya))
  const session = estate.session(sessionId)!
  const savedOwner = session.owner
  session.owner = undefined as unknown as typeof session.owner
  expect(
    (await dispatchViya(services, 'GET', path, { subject: owner })).status
  ).toBe(404)
  session.owner = savedOwner
  expect(
    (
      await dispatchViya(services, 'DELETE', `/compute/sessions/${sessionId}`, {
        subject: owner
      })
    ).status
  ).toBe(204)
  expect(
    (await dispatchViya(services, 'GET', path, { subject: owner })).status
  ).toBe(404)
})

test('supports empty and default pages and rejects unsupported type and timeout', async () => {
  const { services, path } = await setup()
  const result = await dispatchViya(services, 'GET', path, { subject: owner })
  expect(result.body).toEqual(
    expect.objectContaining({
      start: 0,
      limit: 10,
      count: lines.length,
      items: lines
        .slice(0, 10)
        .map((line) => ({ line, type: 'NOTE', version: 2 }))
    })
  )
  const empty = await dispatchViya(services, 'GET', path, {
    subject: owner,
    query: { start: '3', limit: '0' }
  })
  expect(empty.body).toEqual(
    expect.objectContaining({
      count: lines.length,
      start: 3,
      limit: 0,
      items: []
    })
  )
  for (const query of [{ type: 'error' }, { timeout: '1' }])
    expect(
      (await dispatchViya(services, 'GET', path, { subject: owner, query }))
        .status
    ).toBe(400)
})
