import { dispatchViya } from '../src/viya/dispatch.js'
import { EMULATED_CONTEXT_ID } from '../src/viya/compute.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { estateFor } from '../src/viya/sessions.js'
import { estateKeyOf, seedOf, type ViyaRun } from '../src/viya/seed.js'
import type { Services } from '../src/host/dispatch.js'
import type { Subject } from '../src/identity/types.js'

const alice: Subject = { userId: 'alice', clientId: 'web_app' }
const bob: Subject = { userId: 'bob', clientId: 'web_app' }
let serial = 0

const fixture = async (withExecutor: boolean) => {
  const execute = jest.fn(async (): Promise<ViyaRun> => ({ log: 'host log' }))
  const services: Services = {
    drive: createDriveService(new MemoryDriveStore()),
    viya: {
      serverUrl: `http://code-validation-${serial++}.invalid`,
      ...(withExecutor ? { execute } : {})
    }
  }
  const response = await dispatchViya(
    services,
    'POST',
    `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
    { subject: alice }
  )
  expect(response.status).toBe(201)
  const id = (response.body as { id: string }).id
  const estate = estateFor(estateKeyOf(services.viya), seedOf(services.viya))
  const session = estate.session(id)!
  return {
    services,
    execute,
    estate,
    session,
    path: `/compute/sessions/${id}/jobs`
  }
}

const invalidBodies: Array<[string, unknown]> = [
  ['null code', { code: null }],
  ['object code', { code: { program: 'x' } }],
  ['number code', { code: 42 }],
  ['boolean code', { code: false }],
  ['mixed lines', { code: ['x', 42] }],
  ['null line', { code: ['x', null] }],
  ['nested lines', { code: [['x']] }],
  ['sparse lines', { code: Array(1) }],
  ['null body', null],
  ['array body', []],
  ['string body', 'program'],
  ['number body', 42]
]

describe.each([false, true])(
  'mock job validation with executor=%s',
  (withExecutor) => {
    it.each(invalidBodies)(
      'refuses %s without a job, log or executor call',
      async (_label, body) => {
        const { services, execute, estate, session, path } =
          await fixture(withExecutor)
        const submit = jest.spyOn(estate, 'submit')
        const response = await dispatchViya(services, 'POST', path, {
          subject: alice,
          body: body as Record<string, unknown>
        })
        expect(response.status).toBe(400)
        expect(response.body).toMatchObject({
          message: 'Compute job code must be a string or an array of strings.'
        })
        expect(submit).not.toHaveBeenCalled()
        expect(session.submitted).toBe(0)
        expect(session.jobs.size).toBe(0)
        expect(execute).not.toHaveBeenCalled()
        expect(
          (
            await dispatchViya(
              services,
              'GET',
              path.replace('/jobs', '/filerefs/_webout/content'),
              { subject: alice }
            )
          ).status
        ).toBe(404)
        submit.mockRestore()
      }
    )
  }
)

it('keeps owner and unresolved-token refusals ahead of body validation', async () => {
  const { services, execute, estate, session, path } = await fixture(true)
  const submit = jest.spyOn(estate, 'submit')
  expect(
    (
      await dispatchViya(services, 'POST', path, {
        subject: bob,
        body: { code: null }
      })
    ).status
  ).toBe(404)
  expect(
    (
      await dispatchViya(services, 'POST', path, {
        token: 'unresolved',
        body: { code: null }
      })
    ).status
  ).toBe(401)
  expect(
    (
      await dispatchViya(
        {
          ...services,
          viya: { ...services.viya, serverUrl: 'http://other-estate.invalid' }
        },
        'POST',
        path,
        { subject: alice, body: { code: null } }
      )
    ).status
  ).toBe(404)
  expect(submit).not.toHaveBeenCalled()
  expect(session.submitted).toBe(0)
  expect(session.jobs.size).toBe(0)
  expect(execute).not.toHaveBeenCalled()
  submit.mockRestore()
})

it('accepts an omitted request body as an empty program', async () => {
  const { services, execute, path } = await fixture(true)
  expect(
    (await dispatchViya(services, 'POST', path, { subject: alice })).status
  ).toBe(201)
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ program: '' }))
})

it('does not hide the last valid webout after an invalid submission', async () => {
  const { services, execute, session, path } = await fixture(true)
  execute.mockResolvedValue({ log: 'host log', webout: 'previous output' })
  expect(
    (
      await dispatchViya(services, 'POST', path, {
        subject: alice,
        body: { code: ['valid'] }
      })
    ).status
  ).toBe(201)
  await Promise.resolve()
  expect(
    (
      await dispatchViya(services, 'POST', path, {
        subject: alice,
        body: { code: null }
      })
    ).status
  ).toBe(400)
  const response = await dispatchViya(
    services,
    'GET',
    path.replace('/jobs', '/filerefs/_webout/content'),
    { subject: alice }
  )
  expect(response.contents).toBe('previous output')
  expect(session.submitted).toBe(1)
  expect(execute).toHaveBeenCalledTimes(1)
})

it.each([
  ['string', { code: 'line 1\nline 2' }, 'line 1\nline 2'],
  ['array', { code: ['line 1', 'line 2'] }, ['line 1', 'line 2']],
  ['empty string', { code: '' }, ''],
  ['empty array', { code: [] }, []],
  ['omitted code', {}, '']
])(
  'preserves %s programs for the host executor',
  async (_label, body, program) => {
    const { services, execute, path } = await fixture(true)
    expect(
      (await dispatchViya(services, 'POST', path, { subject: alice, body }))
        .status
    ).toBe(201)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ program }))
  }
)
