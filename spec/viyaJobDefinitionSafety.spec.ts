import { dispatchViya } from '../src/viya/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import type { Services } from '../src/host/dispatch.js'

const setup = async () => {
  const store = new MemoryDriveStore()
  const services: Services = {
    drive: createDriveService(store),
    viya: { allowUntransactionalJobDefinitionCreation: true }
  }
  const folder = await dispatchViya(services, 'POST', '/folders/folders', {
    body: { name: 'app' }
  })
  const folderId = (folder.body as { id: string }).id
  const create = (name: string) =>
    dispatchViya(services, 'POST', '/jobDefinitions/definitions', {
      query: { parentFolderUri: `/folders/folders/${folderId}` },
      body: { name, code: 'do not execute', type: 'Compute', parameters: [] }
    })
  return { store, services, folderId, create }
}

it('refuses duplicate definition names in a folder without changing the original', async () => {
  const { create, services } = await setup()
  const first = await create('same')
  expect(first.status).toBe(201)
  expect((await create('same')).status).toBe(409)
  const id = (first.body as { id: string }).id
  expect(
    (await dispatchViya(services, 'GET', `/jobDefinitions/definitions/${id}`))
      .body
  ).toEqual(first.body)
})

it('does not hide a storage read failure as a missing definition', async () => {
  const { create, services } = await setup()
  const created = await create('hello')
  const id = (created.body as { id: string }).id
  services.drive.read = async () => {
    throw new Error('storage unavailable')
  }
  const answer = await dispatchViya(
    services,
    'GET',
    `/jobDefinitions/definitions/${id}`
  )
  expect(answer.status).toBe(500)
})

it('rejects a path-shaped definition name instead of treating it as a resource name', async () => {
  const { create, store } = await setup()
  expect((await create('../../outside')).status).toBe(400)
  expect(Object.keys(store.dump())).toEqual([])
})
