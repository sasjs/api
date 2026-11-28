import { dispatchViya } from '../src/viya/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import type { Services } from '../src/host/dispatch.js'

it('lists mixed folder members without reading definition contents or statting files when the host denies metadata reads', async () => {
  const store = new MemoryDriveStore({
    '/app/nested/ordinary.txt': 'ordinary',
    '/app/nested/.sasjs-viya-job-not-a-uuid.json': 'ordinary',
    '/app/nested/.sasjs-viya-job-12345678-1234-4123-8123-123456789abc.json':
      'secret',
    '/unrelated/file.txt': 'unrelated'
  })
  const drive = createDriveService(store)
  await drive.mkdir('/app/nested/child')
  const base: Services = { drive }
  const folder = await dispatchViya(base, 'GET', '/folders/folders/@item', {
    query: { path: '/app/nested' }
  })
  const id = (folder.body as { id: string }).id
  const stats: string[] = []
  const stat = store.stat.bind(store)
  store.stat = async (path) => {
    stats.push(path)
    return stat(path)
  }
  const reads = jest.spyOn(drive, 'read').mockImplementation(async () => {
    throw new Error('file read forbidden')
  })
  const viya = {
    serverUrl: 'http://localhost',
    readJobDefinitionMetadata: false
  }
  const safe: Services = { drive, viya }
  const result = await dispatchViya(
    safe,
    'GET',
    `/folders/folders/${id}/members`,
    {
      query: { limit: '2', readJobDefinitionMetadata: 'true' }
    }
  )
  expect(result.status).toBe(200)
  expect(result.body).toMatchObject({
    start: 0,
    limit: 2,
    count: 2,
    items: [
      { name: 'child', type: 'folder' },
      { name: '.sasjs-viya-job-not-a-uuid.json', type: 'file' }
    ]
  })
  expect(reads).not.toHaveBeenCalled()
  const next = await dispatchViya(
    safe,
    'GET',
    `/folders/folders/${id}/members`,
    {
      query: { start: '2', limit: '1' }
    }
  )
  expect(next.status).toBe(200)
  expect(next.body).toMatchObject({
    start: 2,
    limit: 1,
    count: 1,
    items: [{ name: 'ordinary.txt', type: 'file' }]
  })
  expect(reads).not.toHaveBeenCalled()
  expect(stats).not.toContain('/app/nested/ordinary.txt')
  expect(stats).not.toContain('/unrelated/file.txt')
  expect(stats).not.toContain(
    '/app/nested/.sasjs-viya-job-12345678-1234-4123-8123-123456789abc.json'
  )
})

it('keeps normal discovery and ignores a request trying to disable it', async () => {
  const drive = createDriveService(new MemoryDriveStore())
  const services: Services = {
    drive,
    viya: { allowUntransactionalJobDefinitionCreation: true }
  }
  await drive.mkdir('/app')
  const folder = await dispatchViya(services, 'GET', '/folders/folders/@item', {
    query: { path: '/app' }
  })
  const id = (folder.body as { id: string }).id
  const created = await dispatchViya(
    services,
    'POST',
    '/jobDefinitions/definitions',
    {
      query: { parentFolderUri: `/folders/folders/${id}` },
      body: { name: 'job', type: 'Compute', code: 'secret', parameters: [] }
    }
  )
  expect(created.status).toBe(201)
  await drive.save('/app/ordinary.txt', 'ordinary')
  const read = jest.spyOn(drive, 'read')
  const response = await dispatchViya(
    services,
    'GET',
    `/folders/folders/${id}/members`,
    {
      query: { readJobDefinitionMetadata: 'false', limit: '1', start: '1' }
    }
  )
  expect(response.status).toBe(200)
  expect(response.body).toMatchObject({
    start: 1,
    count: 1,
    items: [{ name: 'job', contentType: 'jobDefinition' }]
  })
  expect(read).toHaveBeenCalledTimes(1)
})

it('resolves folder IDs and recycle bin using only list and never reads files', async () => {
  const drive = createDriveService(
    new MemoryDriveStore({ '/one/two/file.txt': 'secret' })
  )
  const services: Services = {
    drive,
    viya: { readJobDefinitionMetadata: false }
  }
  const folder = await dispatchViya(services, 'GET', '/folders/folders/@item', {
    query: { path: '/one/two' }
  })
  const id = (folder.body as { id: string }).id
  const read = jest
    .spyOn(drive, 'read')
    .mockRejectedValue(new Error('forbidden'))
  const tree = jest
    .spyOn(drive, 'tree')
    .mockRejectedValue(new Error('forbidden'))
  expect(
    (await dispatchViya(services, 'GET', `/folders/folders/${id}`)).status
  ).toBe(200)
  expect(
    (await dispatchViya(services, 'GET', '/folders/folders/not-found')).status
  ).toBe(404)
  const bin = await dispatchViya(
    services,
    'GET',
    '/folders/folders/@myRecycleBin'
  )
  const binId = (bin.body as { id: string }).id
  const members = await dispatchViya(
    services,
    'GET',
    `/folders/folders/${binId}/members`,
    { query: { start: '2', limit: '3' } }
  )
  expect(members.body).toMatchObject({
    start: 2,
    limit: 3,
    count: 0,
    items: []
  })
  expect(read).not.toHaveBeenCalled()
  expect(tree).not.toHaveBeenCalled()
})
