import { MemoryDriveStore } from '../src/drive/memory-store'
import { createDriveService } from '../src/drive/service'
import {
  APP_STREAM_INDEX,
  createDriveAppStreamStore
} from '../src/appstream/store'
import {
  MemoryAppStreamStore,
  createAppStreamService
} from '../src/appstream/service'

const driveOver = (seed: Record<string, string | Uint8Array> = {}) =>
  createDriveService(new MemoryDriveStore(seed))

describe('the index on the drive', () => {
  it('is empty until something is published', async () => {
    expect(await createDriveAppStreamStore(driveOver()).read()).toEqual([])
  })

  it('is created by the first publish and kept up to date after it', async () => {
    const drive = driveOver()
    const store = createDriveAppStreamStore(drive)
    const apps = createAppStreamService(store)

    const first = await apps.publish({
      appLoc: '/Public/apps/mario',
      streamWebFolder: 'web',
      publishedAt: '2026-01-01T00:00:00.000Z'
    })

    expect(await store.read()).toEqual([first])

    await apps.publish({
      appLoc: '/Public/apps/zelda',
      streamWebFolder: 'web',
      publishedAt: '2026-01-02T00:00:00.000Z'
    })

    expect((await store.read()).map((app) => app.name)).toEqual([
      'mario',
      'zelda'
    ])

    // the index is one file, not one file per app
    const listing = await drive.list('/.sasjs')

    expect(listing.files).toEqual(['apps.json'])
  })

  it('takes a path of its own', async () => {
    const drive = driveOver()
    const store = createDriveAppStreamStore(drive, '/config/apps.json')

    await store.write([])

    expect(await drive.read('/config/apps.json')).toMatchObject({
      contents: '[]'
    })
  })

  it('refuses a file that is not an index, rather than reading it as none', async () => {
    for (const contents of ['{oops', '{"apps":[]}', '[{"id":"x"}]']) {
      const store = createDriveAppStreamStore(
        driveOver({ [APP_STREAM_INDEX]: contents })
      )

      await expect(store.read()).rejects.toMatchObject({ status: 500 })
    }
  })

  it('refuses bytes where the index should be text', async () => {
    const store = createDriveAppStreamStore(
      driveOver({ [APP_STREAM_INDEX]: new Uint8Array([1, 2, 3]) })
    )

    await expect(store.read()).rejects.toMatchObject({
      status: 500,
      message: /is not text/
    })
  })

  it('passes a drive failure that is not "no file yet" up to the host', async () => {
    const broken = {
      read: async () => {
        throw new Error('the drive is offline')
      }
    }

    const store = createDriveAppStreamStore(broken as never)

    await expect(store.read()).rejects.toThrow('the drive is offline')
  })

  it('passes a write failure up too, rather than reporting a publish it lost', async () => {
    const store = createDriveAppStreamStore({
      read: async () => ({}),
      update: async () => {
        throw new Error('read only')
      },
      save: async () => {
        throw new Error('read only')
      }
    } as never)

    await expect(store.write([])).rejects.toThrow('read only')
  })

  it('is the same index the memory store holds, for a host that has no drive', async () => {
    const memory = createAppStreamService(new MemoryAppStreamStore())

    expect(await memory.list()).toEqual([])
  })
})
