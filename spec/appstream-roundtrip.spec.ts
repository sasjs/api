import { createDriveService } from '../src/drive/service'
import { MemoryDriveStore } from '../src/drive/memory-store'
import { dispatch } from '../src/host/dispatch'
import type { Services } from '../src/host/dispatch'
import {
  MemoryAppStreamStore,
  createAppStreamService
} from '../src/appstream/service'
import { createAppStreamWebService } from '../src/appstream/web'

const MANIFEST = JSON.stringify({
  name: 'Mario',
  streamWebFolder: 'web',
  logo: 'logo.png'
})

/** The bundle a deploy request carries: one archive, the app and its folders. */
const bundle = {
  members: [
    { name: 'sasjs.app.json', type: 'file', code: MANIFEST },
    {
      name: 'services',
      type: 'folder',
      members: [
        {
          name: 'web',
          type: 'folder',
          members: [
            { name: 'index.html', type: 'file', code: '<h1>Mario</h1>' },
            { name: 'logo.png', type: 'file', code: 'AAAA', encoding: 'base64' }
          ]
        },
        { name: 'run', type: 'service', code: '%put hello;' }
      ]
    },
    { name: 'jobs', type: 'folder', members: [] }
  ]
}

const host = () => {
  const appStream = createAppStreamService(new MemoryAppStreamStore())
  const drive = createDriveService(new MemoryDriveStore({}))
  const services: Services = { drive, appStream }

  return {
    services,
    appStream,
    drive,
    surface: createAppStreamWebService(appStream, drive)
  }
}

describe('a deployed bundle, opened as an app', () => {
  it('is deployed, indexed and served by one request and one id', async () => {
    const { services, surface, drive } = host()

    const deployed = await dispatch(services, 'POST /SASjsApi/drive/deploy', {
      body: { appLoc: '/Public/apps/mario', fileTree: bundle }
    })

    expect(deployed.status).toBe(200)

    const app = (deployed.body as { app: { id: string; url: string } }).app

    expect(app.url).toBe(`/app/${app.id}/`)

    // the app's own files, from the folder the deploy wrote them to
    const index = await surface.request({ method: 'GET', path: app.url })

    expect(index.status).toBe(200)
    expect(index.body).toBe('<h1>Mario</h1>')

    const logo = await surface.request({
      method: 'GET',
      path: `${app.url}logo.png`
    })

    expect(logo.contentType).toBe('image/png')

    // the manifest is metadata: it indexed the app and is not served from it
    expect(
      await drive.read('/Public/apps/mario/sasjs.app.json').catch(() => null)
    ).toBeNull()

    // the services the app calls are deployed beside it
    expect(
      await drive.read('/Public/apps/mario/services/run.sas')
    ).toMatchObject({
      contents: '%put hello;'
    })

    const { apps } = await surface.apps()

    expect(apps).toEqual([
      expect.objectContaining({
        id: app.id,
        name: 'Mario',
        url: app.url,
        logo: `${app.url}logo.png`
      })
    ])
  })

  it('keeps its id - and so its url - when the bundle is deployed again', async () => {
    const { services, surface } = host()

    const first = await dispatch(services, 'POST /SASjsApi/drive/deploy', {
      body: { appLoc: '/Public/apps/mario', fileTree: bundle }
    })
    const again = await dispatch(
      services,
      'POST /SASjsApi/drive/deploy/upload',
      {
        body: { appLoc: '/Public/apps/mario/', fileTree: bundle }
      }
    )

    expect((again.body as { app: { id: string } }).app.id).toBe(
      (first.body as { app: { id: string } }).app.id
    )
    expect((await surface.apps()).apps).toHaveLength(1)
  })

  it('is gone from the index - and from its url - once it is removed', async () => {
    const { services, surface } = host()

    const deployed = await dispatch(services, 'POST /SASjsApi/drive/deploy', {
      body: { appLoc: '/Public/apps/mario', fileTree: bundle }
    })
    const app = (deployed.body as { app: { id: string; url: string } }).app

    const removed = await surface.request({ method: 'DELETE', path: app.url })

    expect(removed.status).toBe(200)
    expect((await surface.apps()).apps).toEqual([])
    expect(
      (await surface.request({ method: 'GET', path: app.url })).status
    ).toBe(404)
  })

  it('is a plain deployment when the bundle says it is not an app', async () => {
    const { services, surface } = host()

    const deployed = await dispatch(services, 'POST /SASjsApi/drive/deploy', {
      body: {
        appLoc: '/Public/apps/plain',
        fileTree: {
          members: [{ name: 'data.csv', type: 'file', code: 'a,b\n1,2' }]
        }
      }
    })

    expect(deployed.body).toEqual({
      status: 'success',
      message: 'Files deployed successfully to @sasjs/server.'
    })
    expect((await surface.apps()).apps).toEqual([])
  })
})
