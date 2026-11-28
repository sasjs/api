import { SASViyaApiClient } from '@sasjs/adapter/SASViyaApiClient'
import { WebJobExecutor } from '@sasjs/adapter/job-execution/WebJobExecutor'
import { RequestClient } from '@sasjs/adapter/request/RequestClient'
import { ServerType } from '@sasjs/utils/types'
import { dispatchViya } from '../src/viya/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'

it('the published adapter 6.2 traverses folder members and sends the created job URI', async () => {
  const drive = createDriveService(new MemoryDriveStore())
  const services = {
    drive,
    viya: {
      serverUrl: 'http://localhost:5000',
      allowUntransactionalJobDefinitionCreation: true
    }
  }
  await drive.mkdir('/app')
  // A folder with the same name precedes the definition in the listing.
  await drive.mkdir('/app/hello')
  const folder = await dispatchViya(services, 'GET', '/folders/folders/@item', {
    query: { path: '/app' }
  })
  expect(folder.status).toBe(200)
  const folderId = (folder.body as { id: string }).id
  const created = await dispatchViya(
    services,
    'POST',
    '/jobDefinitions/definitions',
    {
      query: { parentFolderUri: `/folders/folders/${folderId}` },
      body: {
        name: 'hello',
        type: 'Compute',
        code: '%put hello;',
        parameters: []
      }
    }
  )
  expect(created.status).toBe(201)
  const id = (created.body as { id: string }).id
  const requests: string[] = []
  const posts: string[] = []
  // Only transport is substituted: both the adapter's client and web executor
  // are the published package. GETs run through the real emulator dispatcher.
  const transport = {
    get: async (url: string) => {
      requests.push(url)
      const parsed = new URL(url, 'http://localhost:5000')
      const query = Object.fromEntries(parsed.searchParams)
      const response = await dispatchViya(services, 'GET', parsed.pathname, {
        query
      })
      if (response.status !== 200)
        throw new Error(`GET failed: ${response.status}`)
      return { result: response.body }
    },
    post: async (url: string) => {
      posts.push(url)
      return { result: { ok: true } }
    },
    appendRequest: () => undefined
  } as unknown as RequestClient
  const client = new SASViyaApiClient(
    'http://localhost:5000',
    '/',
    '',
    transport
  )
  const executor = new WebJobExecutor(
    'http://localhost:5000',
    ServerType.SasViya,
    '/SASJobExecution',
    transport,
    client
  )
  await executor.execute('/app/hello', null, {
    serverUrl: 'http://localhost:5000',
    serverType: ServerType.SasViya,
    debug: false
  })
  expect(requests).toEqual([
    '/folders/folders/@item?path=/app',
    `/folders/folders/${folderId}/members?limit=500`
  ])
  expect(posts).toHaveLength(1)
  const post = new URL(posts[0])
  expect(post.searchParams.get('_job')).toBe(
    `/jobDefinitions/definitions/${id}`
  )
  expect(post.searchParams.get('__program')).toBe('/app/hello')
  expect(post.searchParams.has('_program')).toBe(false)
})
