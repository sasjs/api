import { dispatchViya } from '../src/viya/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { VIYA_CORPUS } from '../src/corpus/viya/operations.js'
import { shapeMismatches } from '../src/corpus/viya/replay.js'
import type { Services } from '../src/host/dispatch.js'

const host = (store: MemoryDriveStore): Services => ({
  drive: createDriveService(store),
  viya: {
    serverUrl: 'http://localhost:5000',
    allowUntransactionalJobDefinitionCreation: true
  }
})

it('persists a definition as inert data, discovers its resource link, and reads it after host reconstruction', async () => {
  const store = new MemoryDriveStore()
  const first = host(store)
  const folder = await dispatchViya(first, 'POST', '/folders/folders', {
    body: { name: 'app' }
  })
  const folderId = (folder.body as { id: string }).id
  const payload = {
    name: 'hello',
    type: 'Compute',
    code: '%put hello;',
    parameters: [
      {
        name: '_addjesbeginendmacros',
        type: 'CHARACTER',
        defaultValue: 'false'
      }
    ]
  }
  const created = await dispatchViya(
    first,
    'POST',
    '/jobDefinitions/definitions',
    {
      query: { parentFolderUri: `/folders/folders/${folderId}` },
      body: payload
    }
  )
  expect(created.status).toBe(201)
  const definition = created.body as { id: string }
  const shape = VIYA_CORPUS.find(
    (item) => item.route === 'POST /jobDefinitions/definitions'
  )!.shape
  expect(shapeMismatches(shape, created.body, 'body')).toEqual([])
  expect(created.body).toMatchObject({
    ...payload,
    parameters: [
      { ...payload.parameters[0], required: false, version: expect.any(Number) }
    ]
  })
  const second = host(new MemoryDriveStore(store.dump()))
  const listing = await dispatchViya(
    second,
    'GET',
    `/folders/folders/${folderId}/members`
  )
  const items = (
    listing.body as {
      items: Array<{
        name: string
        uri: string
        links: Array<{ rel: string; href: string }>
      }>
    }
  ).items
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({
    name: 'hello',
    type: 'child',
    contentType: 'jobDefinition',
    added: expect.any(String),
    links: expect.arrayContaining([
      expect.objectContaining({
        rel: 'getResource',
        type: 'application/vnd.sas.summary',
        method: 'GET'
      })
    ])
  })
  const link = items[0].links.find((item) => item.rel === 'getResource')
  expect(link?.href).toBe(`/jobDefinitions/definitions/${definition.id}`)
  const read = await dispatchViya(second, 'GET', link!.href)
  expect(read.status).toBe(200)
  expect(read.body).toEqual(created.body)
  const readShape = VIYA_CORPUS.find(
    (item) => item.route === 'GET /jobDefinitions/definitions/{}'
  )!.shape
  expect(shapeMismatches(readShape, read.body, 'body')).toEqual([])
})
