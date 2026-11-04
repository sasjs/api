/**
 * The memory store, which the browser build can use as its drive.
 *
 * It is shipped rather than kept in `spec/` because a host needs an
 * implementation of the port, and the browser build's drive is already exactly
 * this shape - a map of path to string or bytes.
 */
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { createDriveService } from '../src/drive/service.js'
import { isApiError } from '../src/types.js'

const service = (seed: Record<string, string | Uint8Array> = {}) =>
  createDriveService(new MemoryDriveStore(seed))

const status = async (promise: Promise<unknown>): Promise<number | string> => {
  try {
    await promise
    return 200
  } catch (error) {
    if (isApiError(error)) return error.status
    return String(error)
  }
}

describe('memory drive store', () => {
  it('creates the folders a seeded file needs', async () => {
    const drive = new MemoryDriveStore({ '/data/reports/a.csv': 'a' })

    expect((await drive.list('/')).folders).toEqual(['data'])
    expect((await drive.list('/data')).folders).toEqual(['reports'])
    expect((await drive.list('/data/reports')).files).toEqual(['a.csv'])
  })

  it('answers for a folder and a file differently', async () => {
    const drive = new MemoryDriveStore({ '/data/a.csv': 'abc' })

    expect(await drive.stat('/data')).toEqual({ directory: true, size: 0 })
    expect(await drive.stat('/data/a.csv')).toEqual({
      directory: false,
      size: 3
    })
  })

  it('puts the bytes it is given, not a reference to them', async () => {
    const contents = Uint8Array.from([1, 2, 3])
    const drive = new MemoryDriveStore({ '/a.bin': contents })
    contents[0] = 9

    expect(await drive.read('/a.bin')).toEqual(Uint8Array.from([1, 2, 3]))
  })

  it('removes a folder with everything under it, and leaves its siblings', async () => {
    const drive = new MemoryDriveStore({
      '/data/reports/a.csv': 'a',
      '/data/reports/nested/b.csv': 'b',
      '/data/keep.csv': 'k'
    })

    await drive.remove('/data/reports')

    expect(await drive.list('/data')).toEqual({
      files: ['keep.csv'],
      folders: []
    })
  })

  it('moves a folder with its contents', async () => {
    const drive = new MemoryDriveStore({
      '/data/reports/a.csv': 'a',
      '/data/reports/nested/b.csv': 'b'
    })

    await drive.move('/data/reports', '/archive')

    expect(await drive.exists('/data/reports')).toBe(false)
    expect(await drive.read('/archive/a.csv')).toBe('a')
    expect(await drive.read('/archive/nested/b.csv')).toBe('b')
  })

  it('dumps the drive for a snapshot', () => {
    const drive = new MemoryDriveStore({ '/data/a.csv': 'a' })

    expect(drive.dump()).toEqual({ '/data/a.csv': 'a' })
  })

  it('refuses a read or a stat of something that is not there', async () => {
    const drive = new MemoryDriveStore()

    await expect(drive.read('/nope.csv')).rejects.toThrow(`File doesn't exist.`)
    await expect(drive.stat('/nope.csv')).rejects.toThrow(`File doesn't exist.`)
  })

  it('keeps bytes as bytes when it moves them', async () => {
    const drive = new MemoryDriveStore({ '/a.bin': Uint8Array.from([1, 2, 3]) })

    await drive.move('/a.bin', '/b.bin')

    expect(await drive.read('/b.bin')).toEqual(Uint8Array.from([1, 2, 3]))
  })
})

describe('drive service over the memory store', () => {
  it('keeps text as text and bytes as bytes', async () => {
    const drive = service()
    await drive.save('/data/a.csv', 'a,b\n')
    await drive.save('/data/pack.zip', Uint8Array.from([80, 75]))

    expect((await drive.read('/data/a.csv')).binary).toBe(false)
    expect((await drive.read('/data/pack.zip')).binary).toBe(true)
  })

  it('refuses the root as a folder to create or delete', async () => {
    const drive = service()

    expect(await status(drive.mkdir('/'))).toBe(400)
    expect(await status(drive.rmdir('/'))).toBe(400)
  })

  it('refuses a folder path that is really a file', async () => {
    const drive = service({ '/data/a.csv': 'a' })

    expect(await status(drive.list('/data/a.csv'))).toBe(400)
  })

  it('refuses a move of a folder inside itself', async () => {
    const drive = service({ '/data/reports/a.csv': 'a' })

    expect(
      await status(drive.rename('/data/reports', '/data/reports/nested'))
    ).toBe(400)
  })

  it('refuses the root as either end of a move', async () => {
    const drive = service({ '/data/a.csv': 'a' })

    expect(await status(drive.rename('/data/a.csv', '/'))).toBe(400)
    expect(await status(drive.rename('/', '/archive'))).toBe(400)
  })

  it('answers the tree of the whole drive when no folder is named', async () => {
    const drive = service({ '/data/a.csv': 'a' })

    const tree = await drive.tree()

    expect(tree.status).toBe('success')
    expect(tree.tree.isFolder).toBe(true)
    expect(tree.tree.children.map((child) => child.name)).toEqual(['data'])
  })
})
