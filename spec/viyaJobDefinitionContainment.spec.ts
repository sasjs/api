import { dispatchViya } from '../src/viya/dispatch.js'
import { VIYA_HANDLERS } from '../src/viya/service.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'

it('refuses definition creation by default without touching Drive, even when the request opts in', async () => {
  const drive = createDriveService(new MemoryDriveStore())
  const list = jest.spyOn(drive, 'list')
  const save = jest.spyOn(drive, 'save')
  const response = await dispatchViya(
    { drive },
    'POST',
    '/jobDefinitions/definitions',
    {
      query: {
        parentFolderUri: '/folders/folders/root',
        allowUntransactionalJobDefinitionCreation: 'true'
      },
      body: {
        name: 'job',
        type: 'Compute',
        code: '',
        parameters: [],
        allowUntransactionalJobDefinitionCreation: true
      }
    }
  )
  expect(response.status).toBe(501)
  expect(list).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

it('refuses unconfigured direct handler calls before touching Drive', async () => {
  const drive = createDriveService(new MemoryDriveStore())
  const list = jest.spyOn(drive, 'list')
  await expect(
    VIYA_HANDLERS['POST /jobDefinitions/definitions']({
      services: { drive },
      params: {},
      request: {
        query: { parentFolderUri: '/folders/folders/root' },
        body: { name: 'job', type: 'Compute', code: '', parameters: [] }
      }
    })
  ).rejects.toMatchObject({ status: 501 })
  expect(list).not.toHaveBeenCalled()
})

it.each([false, 'true', 1])(
  'does not accept a non-boolean-true host capability (%s)',
  async (value) => {
    const drive = createDriveService(new MemoryDriveStore())
    const response = await dispatchViya(
      {
        drive,
        viya: { allowUntransactionalJobDefinitionCreation: value as boolean }
      },
      'POST',
      '/jobDefinitions/definitions',
      { body: { name: 'job', type: 'Compute', code: '', parameters: [] } }
    )
    expect(response.status).toBe(501)
  }
)

it('allows explicitly configured isolated hosts to create and read a definition', async () => {
  const drive = createDriveService(new MemoryDriveStore())
  await drive.mkdir('/app')
  const services = {
    drive,
    viya: { allowUntransactionalJobDefinitionCreation: true }
  }
  const folder = await dispatchViya(services, 'GET', '/folders/folders/@item', {
    query: { path: '/app' }
  })
  const folderId = (folder.body as { id: string }).id
  const response = await dispatchViya(
    services,
    'POST',
    '/jobDefinitions/definitions',
    {
      query: { parentFolderUri: `/folders/folders/${folderId}` },
      body: { name: 'job', type: 'Compute', code: 'inert', parameters: [] }
    }
  )
  expect(response.status).toBe(201)
  const id = (response.body as { id: string }).id
  const read = await dispatchViya(
    { drive },
    'GET',
    `/jobDefinitions/definitions/${id}`
  )
  expect(read.status).toBe(200)
  expect(read.body).toEqual(response.body)
})
