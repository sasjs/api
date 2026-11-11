import {
  MemoryAppStreamStore,
  appSummary,
  checkPublishRequest,
  createAppStreamService,
  defaultAppName,
  hasStreamFolder
} from '../src/appstream/service'
import type { AppStreamEntry } from '../src/appstream/service'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const service = (entries: AppStreamEntry[] = []) =>
  createAppStreamService(new MemoryAppStreamStore(entries))

const publish = (appLoc: string, extra: Record<string, unknown> = {}) =>
  service().publish({
    appLoc,
    streamWebFolder: 'web',
    publishedAt: '2026-01-01T00:00:00.000Z',
    ...extra
  })

describe('the app index', () => {
  it('mints a uuid when a folder is first published', async () => {
    const app = await publish('/Public/apps/mario')

    expect(app.id).toMatch(UUID)
    expect(app.appLoc).toBe('/Public/apps/mario')
    expect(app.streamWebFolder).toBe('web')
    expect(app.publishedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('labels an app with the last segment of its folder unless told otherwise', async () => {
    expect((await publish('/Public/apps/mario')).name).toBe('mario')
    expect((await publish('/Public/apps/Mario Kart')).name).toBe('Mario Kart')

    const named = await service().publish({
      appLoc: '/Public/apps/mario',
      streamWebFolder: 'web',
      name: 'Super Mario'
    })

    expect(named.name).toBe('Super Mario')

    expect(defaultAppName('/')).toBe('app')
  })

  it('keeps the id when the same folder is published again', async () => {
    const store = new MemoryAppStreamStore()
    const apps = createAppStreamService(store)

    const first = await apps.publish({
      appLoc: '/Public/apps/mario',
      streamWebFolder: 'web',
      name: 'Mario',
      logo: 'logo.png'
    })

    const again = await apps.publish({
      appLoc: '/Public//apps/mario/',
      streamWebFolder: 'dist',
      name: 'Mario'
    })

    expect(again.id).toBe(first.id)
    expect(again.appLoc).toBe('/Public/apps/mario')
    expect(again.streamWebFolder).toBe('dist')
    expect(await apps.list()).toHaveLength(1)
  })

  it('treats the entry as the publish: a field it omits is gone', async () => {
    const store = new MemoryAppStreamStore()
    const apps = createAppStreamService(store)

    await apps.publish({
      appLoc: '/Public/apps/mario',
      streamWebFolder: 'web',
      logo: 'logo.png',
      frameAncestors: ['https://example.com']
    })

    const again = await apps.publish({
      appLoc: '/Public/apps/mario',
      streamWebFolder: 'web'
    })

    expect(again.logo).toBeUndefined()
    expect(again.frameAncestors).toBeUndefined()
  })

  it('gives two folders two ids, even under one label', async () => {
    const apps = service()

    const a = await apps.publish({
      appLoc: '/Public/a/report',
      streamWebFolder: 'web',
      name: 'report'
    })
    const b = await apps.publish({
      appLoc: '/Public/b/report',
      streamWebFolder: 'web',
      name: 'report'
    })

    expect(a.id).not.toBe(b.id)
    expect(await apps.list()).toHaveLength(2)
  })

  it('keeps a label that was set, over the folder default, on a redeploy', async () => {
    const apps = service()

    await apps.publish({
      appLoc: '/Public/apps/x',
      streamWebFolder: 'web',
      name: 'Sales'
    })

    const again = await apps.publish({
      appLoc: '/Public/apps/x',
      streamWebFolder: 'web'
    })

    expect(again.name).toBe('Sales')
  })

  it('normalises frame ancestors to a list, and copies it', async () => {
    const single = await publish('/Public/apps/a', {
      frameAncestors: 'https://example.com'
    })
    const list = await publish('/Public/apps/b', {
      frameAncestors: ['https://one.example', 'https://two.example']
    })

    expect(single.frameAncestors).toEqual(['https://example.com'])
    expect(list.frameAncestors).toEqual([
      'https://one.example',
      'https://two.example'
    ])
  })

  it('refuses a publish that does not say enough to be one', async () => {
    const apps = service()

    await expect(
      apps.publish({ appLoc: '', streamWebFolder: 'web' })
    ).rejects.toMatchObject({ status: 400, message: /non-empty string/ })

    await expect(
      apps.publish({ appLoc: '/../..', streamWebFolder: 'web' })
    ).rejects.toMatchObject({ status: 400, message: /outside drive/ })

    await expect(
      apps.publish({ appLoc: '/Public/apps/a', streamWebFolder: '' })
    ).rejects.toMatchObject({
      status: 400,
      message: '"streamWebFolder" is required'
    })

    for (const folder of ['a/b', '..', '.', 'a\\b']) {
      await expect(
        apps.publish({ appLoc: '/Public/apps/a', streamWebFolder: folder })
      ).rejects.toMatchObject({
        status: 400,
        message: 'streamWebFolder must be a single path segment.'
      })
    }

    await expect(
      apps.publish({
        appLoc: '/Public/apps/a',
        streamWebFolder: 'web',
        name: '  '
      })
    ).rejects.toMatchObject({ status: 400, message: /"name"/ })

    await expect(
      apps.publish({
        appLoc: '/Public/apps/a',
        streamWebFolder: 'web',
        logo: 5 as unknown as string
      })
    ).rejects.toMatchObject({ status: 400, message: /"logo"/ })

    await expect(
      apps.publish({
        appLoc: '/Public/apps/a',
        streamWebFolder: 'web',
        frameAncestors: []
      })
    ).rejects.toMatchObject({ status: 400, message: /"frameAncestors"/ })

    await expect(
      apps.publish({
        appLoc: '/Public/apps/a',
        streamWebFolder: 'web',
        frameAncestors: ['ok', '']
      })
    ).rejects.toMatchObject({ status: 400, message: /"frameAncestors"/ })
  })

  it('refuses a tree that does not carry the folder the app would be served from', async () => {
    const request = { appLoc: '/Public/apps/a', streamWebFolder: 'web' }
    const refusal = /no "services\/web" folder/

    // no tree stated: the check is about the request alone, as it always was
    expect(checkPublishRequest(request).streamWebFolder).toBe('web')

    // a request with no folder has no default: an app is served from one
    expect(() =>
      checkPublishRequest({ appLoc: '/Public/apps/a', streamWebFolder: '' })
    ).toThrow('"streamWebFolder" is required')

    const services = (members: unknown[]) => ({
      members: [{ name: 'services', type: 'folder', members }]
    })

    // the folder the app is served from is there
    expect(
      checkPublishRequest(request, services([{ name: 'web', type: 'folder' }]))
        .appLoc
    ).toBe('/Public/apps/a')

    // `services` present, the folder not
    expect(() =>
      checkPublishRequest(
        request,
        services([{ name: 'other', type: 'folder' }])
      )
    ).toThrow(refusal)

    // the name held by a FILE rather than a folder
    expect(() =>
      checkPublishRequest(
        request,
        services([{ name: 'web', type: 'file', code: '' }])
      )
    ).toThrow(refusal)

    // nothing that reads as a tree at all
    expect(() => checkPublishRequest(request, { members: [] })).toThrow(refusal)

    // advice that names the source: a bundle stating the folder cannot omit it
    expect(() =>
      checkPublishRequest(
        request,
        { members: [] },
        { folderFromManifest: true }
      )
    ).toThrow(/correct the folder sasjs\.app\.json names\./)
    expect(() => checkPublishRequest(request, 'nope')).toThrow(refusal)

    expect(hasStreamFolder(undefined, 'web')).toBe(false)
    expect(hasStreamFolder({ members: [] }, 'web')).toBe(false)
  })

  it('lists apps by label, filtered by the caller rule', async () => {
    const apps = service()

    await apps.publish({
      appLoc: '/Public/b',
      streamWebFolder: 'web',
      name: 'Beta'
    })
    await apps.publish({
      appLoc: '/Public/a',
      streamWebFolder: 'web',
      name: 'Alpha'
    })

    expect((await apps.list()).map((app) => app.name)).toEqual([
      'Alpha',
      'Beta'
    ])
    expect(
      (await apps.list((app) => app.name === 'Beta')).map((app) => app.name)
    ).toEqual(['Beta'])
  })

  it('reads one app by id, and answers 404 for an id it does not hold', async () => {
    const apps = service()
    const published = await apps.publish({
      appLoc: '/Public/apps/mario',
      streamWebFolder: 'web'
    })

    expect((await apps.get(published.id)).appLoc).toBe('/Public/apps/mario')
    await expect(apps.get('no-such-id')).rejects.toMatchObject({
      status: 404,
      message: 'No app is published with that id.'
    })
  })

  it('finds the app at a folder however the folder is spelled', async () => {
    const apps = service()

    await apps.publish({ appLoc: '/Public/apps/mario', streamWebFolder: 'web' })

    expect((await apps.forAppLoc('/Public/apps/mario/'))?.appLoc).toBe(
      '/Public/apps/mario'
    )
    expect(await apps.forAppLoc('/Public/../..')).toBeUndefined()
    expect(await apps.forAppLoc('/Public/apps/other')).toBeUndefined()
  })

  it('removes the app the id names, and says what went', async () => {
    const apps = service()
    const published = await apps.publish({
      appLoc: '/Public/apps/mario',
      streamWebFolder: 'web'
    })

    expect((await apps.unpublish(published.id)).id).toBe(published.id)
    expect(await apps.list()).toEqual([])
  })

  it('answers 404 for an id that is not published, and for no id at all', async () => {
    const apps = service()

    await expect(apps.unpublish('no-such-id')).rejects.toMatchObject({
      status: 404,
      message: 'No app is published with that id.'
    })

    // an empty value reaches the same guard: the route refuses a missing field
    // before this, and a host calling in here gets one answer either way
    await expect(apps.unpublish('')).rejects.toMatchObject({ status: 404 })
  })

  it('refuses the drive root, where a deployment cannot be read back', async () => {
    await expect(
      service().publish({ appLoc: '/', streamWebFolder: 'web' })
    ).rejects.toMatchObject({
      status: 400,
      message: 'An app cannot be published at the drive root.'
    })
  })

  it('is not stopped by one stored entry whose folder could never have been one', async () => {
    // the bad entry matches nothing; it must not make every publish and every
    // redeploy lookup on the host throw
    const apps = createAppStreamService(
      new MemoryAppStreamStore([
        {
          id: '3f9c1c1e-6a1e-4c4a-9d1a-1b2c3d4e5f60',
          name: 'broken',
          appLoc: '',
          streamWebFolder: 'web',
          publishedAt: '2026-01-01T00:00:00.000Z'
        }
      ])
    )

    const published = await apps.publish({
      appLoc: '/Public/apps/b',
      streamWebFolder: 'web'
    })

    expect(published.id).toMatch(UUID)
    expect(await apps.forAppLoc('/Public/apps/b')).toMatchObject({
      appLoc: '/Public/apps/b'
    })
    // and the broken entry is still listed, rather than silently dropped
    expect((await apps.list()).map((app) => app.name)).toContain('broken')
  })

  it('removes an entry whose folder could never have been one, by its id', async () => {
    // a hand-edited index: the id is still a handle, so the entry can be cleaned
    // up rather than becoming one nothing can remove
    const id = '3f9c1c1e-6a1e-4c4a-9d1a-1b2c3d4e5f60'

    const apps = createAppStreamService(
      new MemoryAppStreamStore([
        {
          id,
          name: 'broken',
          appLoc: '/../..',
          streamWebFolder: 'web',
          publishedAt: '2026-01-01T00:00:00.000Z'
        }
      ])
    )

    expect((await apps.unpublish(id)).name).toBe('broken')
    expect(await apps.list()).toEqual([])
  })

  it('keeps two overlapping publishes from discarding each other', async () => {
    const apps = service()

    await Promise.all([
      apps.publish({ appLoc: '/Public/a', streamWebFolder: 'web' }),
      apps.publish({ appLoc: '/Public/b', streamWebFolder: 'web' }),
      apps.publish({ appLoc: '/Public/c', streamWebFolder: 'web' })
    ])

    expect((await apps.list()).map((app) => app.appLoc)).toEqual([
      '/Public/a',
      '/Public/b',
      '/Public/c'
    ])
  })

  it('survives a mutation that fails, rather than wedging the queue', async () => {
    const apps = service()

    await expect(
      apps.publish({ appLoc: '', streamWebFolder: 'web' })
    ).rejects.toMatchObject({ status: 400 })

    const published = await apps.publish({
      appLoc: '/Public/apps/a',
      streamWebFolder: 'web'
    })

    expect(published.id).toMatch(UUID)
  })

  it('answers what a client needs to print an app url', async () => {
    const app = await publish('/Public/apps/mario')

    expect(appSummary(app)).toEqual({
      id: app.id,
      name: 'mario',
      url: `/app/${app.id}/`
    })
  })
})

describe('the memory store', () => {
  it('holds copies, so a caller cannot reach in and change the index', async () => {
    const store = new MemoryAppStreamStore()

    const entry = await publish('/Public/apps/mario')
    await store.write([entry])

    const read = await store.read()
    read[0].name = 'changed'

    expect((await store.read())[0].name).toBe('mario')
  })
})
