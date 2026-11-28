import { dispatchViya } from '../src/viya/dispatch.js'
import { EMULATED_CONTEXT_ID } from '../src/viya/compute.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import type { Services } from '../src/host/dispatch.js'

it('keeps definitions inert while Compute uses its own trusted executor and ownership', async () => {
  const execute = jest.fn(async () => ({
    state: 'warning' as const,
    jobConditionCode: 4,
    log: 'line one\nline two'
  }))
  const drive = createDriveService(new MemoryDriveStore())
  const owner = { userId: 'alice', ownerId: 'alice-id', clientId: 'app' }
  const foreign = { ...owner, ownerId: 'bob-id' }
  const viya = {
    serverUrl: 'http://definitions-compute.invalid',
    allowUntransactionalJobDefinitionCreation: true,
    mockSysjobid: true,
    execute
  }
  const host: Services = { drive, viya }
  const folder = await dispatchViya(host, 'POST', '/folders/folders', {
    body: { name: 'app' }
  })
  expect(folder.status).toBe(201)
  const folderId = (folder.body as { id: string }).id
  const definitionRequest = {
    query: { parentFolderUri: `/folders/folders/${folderId}` },
    body: {
      name: 'inert',
      type: 'Compute',
      code: 'do not execute',
      parameters: []
    }
  }
  const denied = await dispatchViya(
    {
      drive,
      viya: { ...viya, allowUntransactionalJobDefinitionCreation: false }
    },
    'POST',
    '/jobDefinitions/definitions',
    definitionRequest
  )
  expect(denied.status).toBe(501)
  const created = await dispatchViya(
    host,
    'POST',
    '/jobDefinitions/definitions',
    definitionRequest
  )
  expect(created.status).toBe(201)
  const definitionId = (created.body as { id: string }).id
  expect(execute).not.toHaveBeenCalled()
  const sessionResult = await dispatchViya(
    host,
    'POST',
    `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
    { subject: owner }
  )
  expect(sessionResult.status).toBe(201)
  const session = (sessionResult.body as { id: string }).id
  const variable = await dispatchViya(
    host,
    'GET',
    `/compute/sessions/${session}/variables/SYSJOBID`,
    { subject: owner }
  )
  expect(variable.body).toMatchObject({ value: `mock-${session}` })
  expect(
    (
      await dispatchViya(
        host,
        'GET',
        `/compute/sessions/${session}/variables/SYSJOBID`,
        { subject: foreign }
      )
    ).status
  ).toBe(404)
  const submitted = await dispatchViya(
    host,
    'POST',
    `/compute/sessions/${session}/jobs`,
    { subject: owner, body: { code: 'explicit submission' } }
  )
  expect(submitted.status).toBe(201)
  await Promise.resolve()
  expect(execute).toHaveBeenCalledTimes(1)
  expect(execute).toHaveBeenCalledWith(
    expect.objectContaining({ program: 'explicit submission' })
  )
  const job = (submitted.body as { id: string }).id
  const path = `/compute/sessions/${session}/jobs/${job}`
  expect(
    (await dispatchViya(host, 'GET', path, { subject: owner })).body
  ).toMatchObject({ state: 'warning', jobConditionCode: 4 })
  const page = await dispatchViya(host, 'GET', `${path}/log`, {
    subject: owner,
    query: { start: '1', limit: '1' }
  })
  expect(page.body).toMatchObject({ count: 2, items: [{ line: 'line two' }] })
  expect(
    (await dispatchViya(host, 'GET', `${path}/log`, { subject: foreign }))
      .status
  ).toBe(404)
  const read = await dispatchViya(
    { drive },
    'GET',
    `/jobDefinitions/definitions/${definitionId}`
  )
  expect(read.status).toBe(200)
  expect(read.body).toEqual(created.body)
  expect(execute).toHaveBeenCalledTimes(1)
})
