import { dispatchViya } from '../src/viya/dispatch.js'
import { EMULATED_CONTEXT_ID } from '../src/viya/compute.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { estateFor } from '../src/viya/sessions.js'
import { estateKeyOf, seedOf, type ViyaRun } from '../src/viya/seed.js'
import type { Services } from '../src/host/dispatch.js'
import type { Subject } from '../src/identity/types.js'

// Synthetic subjects exercise dispatch authorization, not host authentication.
const alice: Subject = { userId: 'alice', clientId: 'web_app' }
const bob: Subject = { userId: 'bob', clientId: 'web_app' }
let serial = 0
const target = (
  execute: NonNullable<Services['viya']>['execute']
): Services => ({
  drive: createDriveService(new MemoryDriveStore()),
  viya: { serverUrl: `http://outcomes-${serial++}.invalid`, execute }
})
const create = async (services: Services, subject: Subject) => {
  const response = await dispatchViya(
    services,
    'POST',
    `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
    { subject }
  )
  expect(response.status).toBe(201)
  return (response.body as { id: string }).id
}
const submit = async (
  services: Services,
  session: string,
  subject: Subject,
  name: string
) => {
  const response = await dispatchViya(
    services,
    'POST',
    `/compute/sessions/${session}/jobs`,
    {
      subject,
      body: {
        name,
        code: 'ERROR: WARNING: SYSCC=99',
        state: 'error',
        jobConditionCode: 99
      }
    }
  )
  expect(response.status).toBe(201)
  expect((response.body as { state: string }).state).toBe('running')
  return (response.body as { id: string }).id
}
const jobPath = (session: string, job: string) =>
  `/compute/sessions/${session}/jobs/${job}`

it('propagates an explicit warning and condition code to the owning job only', async () => {
  let finish!: (run: ViyaRun) => void
  const services = target(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const session = await create(services, alice)
  const job = await submit(services, session, alice, 'warning')
  const path = jobPath(session, job)
  expect(
    (await dispatchViya(services, 'GET', `${path}/state`, { subject: alice }))
      .body
  ).toBe('running')
  finish({ state: 'warning', log: 'no diagnostic text', jobConditionCode: 4 })
  await Promise.resolve()
  const status = await dispatchViya(services, 'GET', path, { subject: alice })
  expect(status.body).toMatchObject({
    state: 'warning',
    jobConditionCode: 4,
    completedTimeStamp: expect.any(String)
  })
  expect(
    (await dispatchViya(services, 'GET', `${path}/state`, { subject: alice }))
      .body
  ).toBe('warning')
  const record = estateFor(estateKeyOf(services.viya), seedOf(services.viya))
    .session(session)
    ?.jobs.get(job)
  expect(record).toMatchObject({ state: 'warning', jobConditionCode: 4 })
  expect(
    (await dispatchViya(services, 'GET', path, { subject: bob })).status
  ).toBe(404)
  expect(
    (await dispatchViya(services, 'GET', `${path}/state`, { subject: bob }))
      .status
  ).toBe(404)
})

it('keeps independent outcomes per job and session without inferring from text or request fields', async () => {
  const finish = new Map<string, (run: ViyaRun) => void>()
  const services = target(
    ({ name }) =>
      new Promise((resolve) => {
        finish.set(name!, resolve)
      })
  )
  const a = await create(services, alice)
  const b = await create(services, bob)
  const warning = await submit(services, a, alice, 'warning')
  const error = await submit(services, a, alice, 'error')
  const completed = await submit(services, b, bob, 'completed')
  finish.get('error')!({
    state: 'error',
    jobConditionCode: 12,
    log: 'all fine'
  })
  finish.get('completed')!({ log: 'ERROR: failure\nWARNING: SYSCC=500' })
  finish.get('warning')!({ state: 'warning', log: 'ok' })
  await Promise.resolve()
  for (const [session, job, subject, state, code] of [
    [a, warning, alice, 'warning', 0],
    [a, error, alice, 'error', 12],
    [b, completed, bob, 'completed', 0]
  ] as const) {
    const path = jobPath(session, job)
    expect(
      (await dispatchViya(services, 'GET', path, { subject })).body
    ).toMatchObject({ state, jobConditionCode: code })
    expect(
      (await dispatchViya(services, 'GET', `${path}/state`, { subject })).body
    ).toBe(state)
  }
  expect(
    (
      await dispatchViya(services, 'GET', jobPath(b, completed), {
        subject: alice
      })
    ).status
  ).toBe(404)
})

it('retains explicit and thrown failed outcomes without deriving a condition code', async () => {
  const services = target(async ({ name }) => {
    if (name === 'throws') throw new Error('host unavailable')
    return { state: 'failed', log: 'host failed' }
  })
  const session = await create(services, alice)
  for (const name of ['reported', 'throws']) {
    const job = await submit(services, session, alice, name)
    await Promise.resolve()
    await Promise.resolve()
    const path = jobPath(session, job)
    expect(
      (await dispatchViya(services, 'GET', path, { subject: alice })).body
    ).toMatchObject({ state: 'failed', jobConditionCode: 0 })
    expect(
      (await dispatchViya(services, 'GET', `${path}/state`, { subject: alice }))
        .body
    ).toBe('failed')
  }
})
