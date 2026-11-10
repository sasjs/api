import {
  MemoryAppStreamStore,
  appSummary,
  createAppStreamService,
  defaultAppName
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
    ).rejects.toMatchObject({ status: 400, message: /outside the drive/ })

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

  it('removes an app by id, and by the folder it was published from', async () => {
    const byId = service()
    const published = await byId.publish({
      appLoc: '/Public/apps/mario',
      streamWebFolder: 'web'
    })

    expect((await byId.unpublish({ id: published.id })).id).toBe(published.id)
    expect(await byId.list()).toEqual([])

    const byFolder = service()
    await byFolder.publish({
      appLoc: '/Public/apps/mario',
      streamWebFolder: 'web'
    })

    expect(
      (await byFolder.unpublish({ appLoc: '/Public/apps/mario/' })).appLoc
    ).toBe('/Public/apps/mario')
  })

  it('refuses a removal that names nothing, and answers 404 for a miss', async () => {
    const apps = service()

    await expect(apps.unpublish({})).rejects.toMatchObject({ status: 400 })

    await expect(apps.unpublish({ id: 'nope' })).rejects.toMatchObject({
      status: 404,
      message: 'No app is published with that id.'
    })

    await expect(
      apps.unpublish({ appLoc: '/Public/none' })
    ).rejects.toMatchObject({
      status: 404,
      message: 'No app is published at that folder.'
    })

    // a folder that cannot be a folder matches nothing rather than throwing
    await expect(apps.unpublish({ appLoc: '/../..' })).rejects.toMatchObject({
      status: 404
    })
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
