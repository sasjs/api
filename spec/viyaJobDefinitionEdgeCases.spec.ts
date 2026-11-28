import { dispatchViya } from '../src/viya/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { definitionFromFile } from '../src/viya/job-definitions.js'
import type { ApiRequest } from '../src/host/dispatch.js'

const validName = '.sasjs-viya-job-12345678-1234-4123-8123-123456789abc.json'
const validId = '12345678-1234-4123-8123-123456789abc'

it('treats invalid or malformed reserved files as ordinary files', async () => {
  const drive = createDriveService(new MemoryDriveStore())
  expect(await definitionFromFile(drive, '/', 'ordinary')).toBeUndefined()
  for (const contents of [
    'not json',
    'null',
    '{}',
    JSON.stringify({
      id: validId,
      name: 'n',
      code: '',
      type: 't',
      parameters: [],
      links: []
    })
  ]) {
    const eachDrive = createDriveService(new MemoryDriveStore())
    await eachDrive.save(`/${validName}`, contents)
    const result = await definitionFromFile(eachDrive, '/', validName)
    if (contents.startsWith('{"id"')) expect(result?.id).toBe(validId)
    else expect(result).toBeUndefined()
  }
  await drive.save(
    `/${validName}`,
    JSON.stringify({
      id: validId,
      name: 'n',
      code: '',
      type: 't',
      parameters: []
    })
  )
  expect(await definitionFromFile(drive, '/', validName)).toBeUndefined()
})

it.each([
  undefined,
  null,
  {},
  { name: '', type: 'Compute', code: '', parameters: [] },
  { name: '.', type: 'Compute', code: '', parameters: [] },
  { name: '..', type: 'Compute', code: '', parameters: [] },
  { name: 'a/b', type: 'Compute', code: '', parameters: [] },
  { name: 'x', type: 1, code: '', parameters: [] },
  { name: 'x', type: 'Compute', code: 1, parameters: [] },
  { name: 'x', type: 'Compute', code: '', parameters: 'bad' },
  { name: 'x', type: 'Compute', code: '', parameters: [null] },
  {
    name: 'x',
    type: 'Compute',
    code: '',
    parameters: [{ name: 'n', type: 't', defaultValue: 'v', required: 'yes' }]
  }
])('refuses invalid definition input %#', async (body) => {
  const drive = createDriveService(new MemoryDriveStore())
  const save = jest.spyOn(drive, 'save')
  const answer = await dispatchViya(
    { drive, viya: { allowUntransactionalJobDefinitionCreation: true } },
    'POST',
    '/jobDefinitions/definitions',
    { body } as ApiRequest
  )
  expect(answer.status).toBe(400)
  expect(save).not.toHaveBeenCalled()
})

it('rejects sparse parameter arrays before persisting', async () => {
  const drive = createDriveService(new MemoryDriveStore())
  const save = jest.spyOn(drive, 'save')
  const folder = await dispatchViya(
    { drive },
    'GET',
    '/folders/folders/@item',
    {
      query: { path: '/' }
    }
  )
  const id = (folder.body as { id: string }).id
  const response = await dispatchViya(
    { drive, viya: { allowUntransactionalJobDefinitionCreation: true } },
    'POST',
    '/jobDefinitions/definitions',
    {
      query: { parentFolderUri: `/folders/folders/${id}` },
      body: { name: 'job', type: 'Compute', code: '', parameters: Array(1) }
    }
  )
  expect(response.status).toBe(400)
  expect(save).not.toHaveBeenCalled()
})

it('rejects a non-string parent query without writing', async () => {
  const drive = createDriveService(new MemoryDriveStore())
  const save = jest.spyOn(drive, 'save')
  const response = await dispatchViya(
    { drive, viya: { allowUntransactionalJobDefinitionCreation: true } },
    'POST',
    '/jobDefinitions/definitions',
    {
      body: { name: 'job', type: 'Compute', code: '', parameters: [] },
      query: {
        parentFolderUri: ['one', 'two']
      } as unknown as ApiRequest['query']
    }
  )
  expect(response.status).toBe(400)
  expect(save).not.toHaveBeenCalled()
})

it('refuses missing and unknown parent folders and missing or invalid definitions', async () => {
  const drive = createDriveService(new MemoryDriveStore())
  const services = {
    drive,
    viya: { allowUntransactionalJobDefinitionCreation: true }
  }
  const body = { name: 'job', type: 'Compute', code: '', parameters: [] }
  expect(
    (
      await dispatchViya(services, 'POST', '/jobDefinitions/definitions', {
        body
      })
    ).status
  ).toBe(400)
  expect(
    (
      await dispatchViya(services, 'POST', '/jobDefinitions/definitions', {
        body,
        query: { parentFolderUri: '/folders/folders/nonexistent' }
      })
    ).status
  ).toBe(404)
  expect(
    (await dispatchViya(services, 'GET', '/jobDefinitions/definitions/bad'))
      .status
  ).toBe(404)
  expect(
    (
      await dispatchViya(
        services,
        'GET',
        `/jobDefinitions/definitions/${validId}`
      )
    ).status
  ).toBe(404)
})
