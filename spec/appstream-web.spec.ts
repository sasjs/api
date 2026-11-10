import { MemoryDriveStore } from '../src/drive/memory-store'
import { createDriveService } from '../src/drive/service'
import {
  MemoryAppStreamStore,
  createAppStreamService
} from '../src/appstream/service'
import type { AppStreamEntry } from '../src/appstream/service'
import {
  NO_SUCH_APP,
  cacheControlFor,
  contentTypeFor,
  createAppStreamWebService,
  escapeHtml
} from '../src/appstream/web'

const MARIO = '0e6f1d2c-3b4a-4c5d-8e9f-0a1b2c3d4e5f'
const ZELDA = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

const entry = (over: Partial<AppStreamEntry> = {}): AppStreamEntry => ({
  id: MARIO,
  name: 'Mario',
  appLoc: '/Public/apps/mario',
  streamWebFolder: 'web',
  publishedAt: '2026-01-01T00:00:00.000Z',
  ...over
})

const web = async (entries: AppStreamEntry[] = [entry()]) => {
  const appStream = createAppStreamService(new MemoryAppStreamStore(entries))

  const drive = createDriveService(
    new MemoryDriveStore({
      '/Public/apps/mario/services/web/index.html': '<h1>Mario</h1>',
      '/Public/apps/mario/services/web/main.abcdef12.js': 'console.log(1)',
      '/Public/apps/mario/services/web/logo.png': new Uint8Array([1, 2, 3])
    })
  )

  return {
    appStream,
    surface: createAppStreamWebService(appStream, drive)
  }
}

describe('the app listing', () => {
  it('describes an app by its id, with the url that opens it', async () => {
    const { surface } = await web([entry({ logo: 'logo.png' })])

    expect(await surface.apps()).toEqual({
      apps: [
        {
          id: MARIO,
          name: 'Mario',
          appLoc: '/Public/apps/mario',
          logo: `/app/${MARIO}/logo.png`,
          url: `/app/${MARIO}/`,
          publishedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })
  })

  it('offers no logo when the app has none, and no date when the entry has none', async () => {
    const { surface } = await web([
      entry({ publishedAt: undefined as unknown as string })
    ])

    const [app] = (await surface.apps()).apps

    expect(app.logo).toBeNull()
    expect(app.publishedAt).toBeNull()
  })

  it('shows a caller only what its own rule allows', async () => {
    const { surface } = await web([
      entry(),
      entry({ id: ZELDA, name: 'Zelda', appLoc: '/Public/apps/zelda' })
    ])

    const listed = await surface.apps((app) => app.name === 'Zelda')

    expect(listed.apps.map((app) => app.name)).toEqual(['Zelda'])
  })

  it('is served as JSON at /app/apps.json', async () => {
    const { surface } = await web()
    const page = await surface.request({
      method: 'GET',
      path: '/app/apps.json'
    })

    expect(page.status).toBe(200)
    expect(page.contentType).toBe('application/json; charset=utf-8')
    expect(JSON.parse(String(page.body)).apps[0].id).toBe(MARIO)
  })
})

describe('the landing page', () => {
  it('links each app by id and shows where it is deployed', async () => {
    const { surface } = await web()
    const page = await surface.landing()

    expect(page.status).toBe(200)
    expect(page.contentType).toBe('text/html; charset=utf-8')
    expect(String(page.body)).toContain(`href="/app/${MARIO}/"`)
    expect(String(page.body)).toContain('Mario')
    expect(String(page.body)).toContain('/Public/apps/mario')
  })

  it('says so when nothing is published', async () => {
    const { surface } = await web([])

    expect(String((await surface.landing()).body)).toContain(
      'No apps have been published yet.'
    )
  })

  it('escapes a label and a folder rather than interpolating them', async () => {
    const { surface } = await web([
      entry({ name: '<script>alert(1)</script>', appLoc: '/Public/"><b>' })
    ])

    const body = String((await surface.landing()).body)

    expect(body).not.toContain('<script>alert(1)</script>')
    expect(body).toContain('&lt;script&gt;')
    expect(body).toContain('&quot;&gt;&lt;b&gt;')
  })
})

describe('an app url', () => {
  it('redirects to the trailing slash a folder needs', async () => {
    const { surface } = await web()
    const page = await surface.request({ method: 'GET', path: `/app/${MARIO}` })

    expect(page).toMatchObject({
      status: 301,
      location: `/app/${MARIO}/`
    })
  })

  it('serves its index for a folder request', async () => {
    const { surface } = await web()
    const page = await surface.request({
      method: 'GET',
      path: `/app/${MARIO}/`
    })

    expect(page.status).toBe(200)
    expect(page.body).toBe('<h1>Mario</h1>')
    expect(page.contentType).toBe('text/html; charset=utf-8')
    expect(page.headers).toEqual({
      'cache-control': 'public, max-age=0, must-revalidate'
    })
  })

  it('serves a file from the deployment, with the type its name implies', async () => {
    const { surface } = await web()
    const script = await surface.request({
      method: 'GET',
      path: `/app/${MARIO}/main.abcdef12.js`
    })
    const logo = await surface.request({
      method: 'GET',
      path: `/app/${MARIO}/logo.png`
    })

    expect(script.contentType).toBe('text/javascript; charset=utf-8')
    // a content-hashed name ships a new name, never a new body
    expect(script.headers).toEqual({
      'cache-control': 'public, max-age=31536000, immutable'
    })
    expect(logo.contentType).toBe('image/png')
    expect(logo.body).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('resolves a label when one app alone holds it, and refuses an ambiguous one', async () => {
    const { surface } = await web([entry({ name: 'Mario' })])

    const byName = await surface.request({ method: 'GET', path: '/app/Mario/' })

    expect(byName.body).toBe('<h1>Mario</h1>')

    const { surface: ambiguous } = await web([
      entry({ name: 'Same' }),
      entry({ id: ZELDA, name: 'Same', appLoc: '/Public/apps/zelda' })
    ])

    const page = await ambiguous.request({ method: 'GET', path: '/app/Same/' })

    expect(page.status).toBe(404)
    expect(page.body).toContain(NO_SUCH_APP)
  })

  it('answers 404 for an unknown id, a missing file and a path that climbs out', async () => {
    const { surface } = await web()

    for (const path of [
      '/app/no-such-app/',
      `/app/${MARIO}/missing.js`,
      `/app/${MARIO}/../../secrets.txt`,
      '/app/%E0%A4%A/',
      '/elsewhere/app/'
    ]) {
      const page = await surface.request({ method: 'GET', path })

      expect(page.status).toBe(404)
      expect(page.body).toContain(NO_SUCH_APP)
    }
  })

  it('refuses a method the surface does not answer', async () => {
    const { surface } = await web()

    for (const [method, path, allow] of [
      ['PUT', `/app/${MARIO}/`, 'GET, DELETE'],
      ['POST', '/app/', 'GET'],
      ['POST', '/app/apps.json', 'GET']
    ] as const) {
      const page = await surface.request({ method, path })

      expect(page.status).toBe(405)
      expect(page.headers).toEqual({ allow })
    }
  })

  it('honours the path the host mounted it at', async () => {
    const appStream = createAppStreamService(
      new MemoryAppStreamStore([entry()])
    )
    const drive = createDriveService(new MemoryDriveStore({}))

    const root = createAppStreamWebService(appStream, drive, { basePath: '/' })
    const nested = createAppStreamWebService(appStream, drive, {
      basePath: '/apps',
      title: 'My apps'
    })

    expect((await root.request({ method: 'GET', path: '/' })).status).toBe(200)
    expect(
      (await nested.request({ method: 'GET', path: '/apps/apps.json' })).status
    ).toBe(200)
    expect(String((await nested.landing()).body).includes('My apps')).toBe(true)
    // the old address is not an alias any more: it is simply not this surface
    expect(
      (await nested.request({ method: 'GET', path: '/app/' })).status
    ).toBe(404)
  })

  it('takes a query string off the path before reading it', async () => {
    const { surface } = await web()
    const page = await surface.request({
      method: 'GET',
      path: `/app/${MARIO}/?v=1#top`
    })

    expect(page.body).toBe('<h1>Mario</h1>')
  })
})

describe('removing an app', () => {
  it('takes the app out of the index and says what went', async () => {
    const { surface, appStream } = await web()

    const page = await surface.request({
      method: 'DELETE',
      path: `/app/${MARIO}`
    })

    expect(page.status).toBe(200)
    expect(JSON.parse(String(page.body))).toMatchObject({
      status: 'success',
      app: { id: MARIO, url: `/app/${MARIO}/` }
    })
    expect(await appStream.list()).toEqual([])
  })

  it('answers 404 for an app that is not there, or not the caller`s', async () => {
    const { surface } = await web()

    expect(
      (
        await surface.request({
          method: 'DELETE',
          path: '/app/no-such-app'
        })
      ).status
    ).toBe(404)

    expect(
      (
        await surface.request({
          method: 'DELETE',
          path: `/app/${MARIO}`,
          allow: () => false
        })
      ).status
    ).toBe(404)
  })
})

describe('the small rules a host relies on', () => {
  it('names a type by extension, and falls back to bytes', () => {
    expect(contentTypeFor('/a/index.html')).toBe('text/html; charset=utf-8')
    expect(contentTypeFor('/a/app.wasm')).toBe('application/wasm')
    expect(contentTypeFor('/a/main.abc123.js')).toBe(
      'text/javascript; charset=utf-8'
    )
    expect(contentTypeFor('/a/unknown.bin')).toBe('application/octet-stream')
    expect(contentTypeFor('/a/no-extension')).toBe('application/octet-stream')
  })

  it('caches a hashed name hard and everything else for no time at all', () => {
    expect(cacheControlFor('main.0123abcd.js')).toContain('immutable')
    expect(cacheControlFor('main.js')).toContain('must-revalidate')
    expect(cacheControlFor('config.json')).toContain('must-revalidate')
  })

  it('escapes the five characters that end an attribute', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})
