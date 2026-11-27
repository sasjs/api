import { dispatchViya } from '../src/viya/dispatch.js'
import { EMULATED_CONTEXT_ID } from '../src/viya/compute.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { VIYA_CORPUS } from '../src/corpus/viya/operations.js'
import { shapeMismatches } from '../src/corpus/viya/replay.js'
import { estateFor } from '../src/viya/sessions.js'
import { estateKeyOf, seedOf } from '../src/viya/seed.js'
import { VIYA_HANDLERS } from '../src/viya/service.js'
import type { Services } from '../src/host/dispatch.js'

const subject = { userId: 'alice', ownerId: 'a', clientId: 'test' }
const services = (): Services => ({
  drive: createDriveService(new MemoryDriveStore()),
  viya: {
    serverUrl: 'http://sysjobid-test.invalid',
    mockSysjobid: true
  } as NonNullable<Services['viya']>
})

it('preserves the original default refusal even for unresolved credentials', async () => {
  const host = services()
  delete host.viya!.mockSysjobid
  const answer = await dispatchViya(
    host,
    'GET',
    '/compute/sessions/no-session/variables/SYSJOBID',
    { token: 'unresolved' }
  )
  expect(answer.status).toBe(501)
  expect(answer.body).toEqual({
    message:
      'GET /compute/sessions/{}/variables/{} is not emulated. The emulator does not model session variables; the client reads these only to log the pid of a job it is about to submit (SYSJOBID), and any name it asks for is refused here rather than answered with a value the emulator did not run.'
  })
})

it('returns a documented synthetic variable in the recorded shape when a trusted host opts in', async () => {
  const host = services()
  const created = await dispatchViya(
    host,
    'POST',
    `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
    { subject }
  )
  expect(created.status).toBe(201)
  const id = (created.body as { id: string }).id
  const answer = await dispatchViya(
    host,
    'GET',
    `/compute/sessions/${id}/variables/SYSJOBID`,
    { subject }
  )
  expect(answer.status).toBe(200)
  expect(answer.body).toMatchObject({
    name: 'SYSJOBID',
    value: `mock-${id}`,
    scope: 'AUTOMATIC',
    version: 1
  })
  const row = VIYA_CORPUS.find(
    (entry) => entry.route === 'GET /compute/sessions/{}/variables/{}'
  )!
  expect((answer.body as { links: unknown[] }).links).toHaveLength(1)
  expect(shapeMismatches(row.shape, answer.body, 'variable')).toEqual([])
})

it('the installed adapter reads and prints the synthetic value through direct dispatch', async () => {
  const { SessionManager } = require('@sasjs/adapter/SessionManager')
  const {
    executeOnComputeApi
  } = require('@sasjs/adapter/api/viya/executeOnComputeApi')
  const host = services()
  const created = await dispatchViya(
    host,
    'POST',
    `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
    { subject }
  )
  const session = created.body as { id: string }
  const trace: string[] = []
  const client = {
    getBaseUrl: () => 'http://mock.invalid',
    get: async (url: string) => {
      const parsed = new URL(url, 'http://mock.invalid')
      trace.push(`GET ${parsed.pathname}`)
      const response = await dispatchViya(host, 'GET', parsed.pathname, {
        subject,
        query: Object.fromEntries(parsed.searchParams)
      })
      if (response.status >= 400) throw new Error(`HTTP ${response.status}`)
      return { result: response.contents ?? response.body }
    },
    post: async (url: string, body: Record<string, unknown>) => {
      trace.push(`POST ${url}`)
      const response = await dispatchViya(host, 'POST', url, { subject, body })
      if (response.status >= 400) throw new Error(`HTTP ${response.status}`)
      return { result: response.body }
    }
  }
  const manager = new SessionManager('http://mock.invalid', 'mock', client)
  manager.getSession = async () => session
  const logger = jest.spyOn(console, 'info').mockImplementation(() => undefined)
  try {
    const result = await executeOnComputeApi(
      client,
      manager,
      '',
      '/test',
      ['run;'],
      'mock',
      undefined,
      null,
      false,
      false,
      true,
      { maxPollCount: 1, pollInterval: 1 },
      true
    )
    expect(result.job.state).toBe('completed')
    expect(trace).toContain(
      `GET /compute/sessions/${session.id}/variables/SYSJOBID`
    )
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining(`PID mock-${session.id}`)
    )
  } finally {
    logger.mockRestore()
  }
})

it('binds lookup to owner, estate and session lifetime before considering the variable name', async () => {
  const host = services()
  const otherHost: Services = {
    ...host,
    viya: { ...host.viya, serverUrl: 'http://different-estate.invalid' }
  }
  const created = await dispatchViya(
    host,
    'POST',
    `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
    { subject }
  )
  const id = (created.body as { id: string }).id
  const path = (name: string) => `/compute/sessions/${id}/variables/${name}`
  const read = (name: string) =>
    dispatchViya(host, 'GET', path(name), { subject })
  const a = await read('SYSJOBID')
  const b = await read('SYSJOBID')
  expect(a.body).toEqual(b.body)
  const unknown = await read('UNKNOWN')
  expect(unknown.status).toBe(501)
  expect(unknown.body).toEqual({
    message:
      'GET /compute/sessions/{}/variables/{} is not emulated. The emulator does not model session variables; the client reads these only to log the pid of a job it is about to submit (SYSJOBID), and any name it asks for is refused here rather than answered with a value the emulator did not run.'
  })
  for (const name of ['SYSJOBID', 'UNKNOWN']) {
    expect(
      (
        await dispatchViya(host, 'GET', path(name), {
          subject: { ...subject, ownerId: 'b' }
        })
      ).status
    ).toBe(404)
    expect(
      (await dispatchViya(otherHost, 'GET', path(name), { subject })).status
    ).toBe(404)
    expect(
      (await dispatchViya(host, 'GET', path(name), { token: 'unresolved' }))
        .status
    ).toBe(401)
  }
  const estate = estateFor(estateKeyOf(host.viya), seedOf(host.viya))
  const session = estate.session(id)!
  const legacy = session as unknown as { owner?: typeof session.owner }
  const owner = legacy.owner
  legacy.owner = undefined
  expect((await read('SYSJOBID')).status).toBe(404)
  legacy.owner = owner
  expect(
    (await dispatchViya(host, 'DELETE', `/compute/sessions/${id}`, { subject }))
      .status
  ).toBe(204)
  expect((await read('SYSJOBID')).status).toBe(404)
  expect((await read('UNKNOWN')).status).toBe(404)
})

it('does not permit direct handler access to bypass the trusted opt-in or unresolved credentials', async () => {
  const host = services()
  const created = await dispatchViya(
    host,
    'POST',
    `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
    { subject }
  )
  const id = (created.body as { id: string }).id
  const handler = VIYA_HANDLERS['GET /compute/sessions/{}/variables/{}']
  const params = { id, segments: [id, 'SYSJOBID'] } as unknown as Record<
    string,
    string
  >
  const disabled: Services = {
    ...host,
    viya: { ...host.viya, mockSysjobid: false }
  }
  await expect(
    handler({ services: disabled, params, request: { subject } })
  ).rejects.toMatchObject({ status: 501 })
  await expect(
    handler({ services: host, params, request: { token: 'unresolved' } })
  ).rejects.toMatchObject({ status: 401 })
})
