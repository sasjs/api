/**
 * The deploy cap, and the promise that a refused deploy writes nothing.
 *
 * The numbers and the wording are `sasjs/server`'s, and they are asserted here
 * because they now live in this package: a host that passes its own, stricter
 * `limits` still gets the same sentence structure, and the corpus pins the
 * default ones against whatever a host answers.
 */
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import {
  DEPLOY_LIMITS,
  checkDeployTree,
  decodeBase64,
  deployTree,
  isDeployTree,
  measureDeployTree
} from '../src/drive/deploy.js'
import type { DeployMember } from '../src/drive/deploy.js'
import { ApiError, isApiError } from '../src/types.js'

const limits = { entries: 5, totalBytes: 100, fileBytes: 40 }

/** `levels` nested folders, with one small file inside the innermost. */
const nest = (levels: number): DeployMember[] => {
  let members: DeployMember[] = [file('leaf.bin', 1)]

  for (let level = 0; level < levels; level++) members = [folder('d', members)]

  return members
}

/** A file member whose base64 body decodes to exactly `size` bytes. */
const file = (name: string, size: number): DeployMember => ({
  name,
  type: 'file',
  code:
    'A'.repeat(Math.floor(size / 3) * 4) +
    (size % 3 === 1 ? 'AA==' : size % 3 === 2 ? 'AAA=' : '')
})

const folder = (name: string, members: DeployMember[]): DeployMember => ({
  name,
  type: 'folder',
  members
})

const service = (name: string, code: string): DeployMember => ({
  name,
  type: 'service',
  code
})

describe('the deploy cap', () => {
  it('accepts a tree at every limit', () => {
    // 5 entries counting the folder, 100 bytes total, 40 bytes in the largest
    const tree = [
      folder('app', [file('a.bin', 40), file('b.bin', 30), service('s', 'x')]),
      file('c.bin', 29)
    ]

    expect(measureDeployTree(tree)).toEqual({
      entries: 5,
      totalBytes: 100,
      largest: { path: 'app/a.bin', bytes: 40 }
    })
    expect(checkDeployTree(tree, limits)).toBeNull()
  })

  it('refuses one entry past the cap, naming the figure and the limit', () => {
    const tree = [
      folder('app', [
        file('a.bin', 1),
        file('b.bin', 1),
        file('c.bin', 1),
        file('d.bin', 1),
        file('e.bin', 1)
      ])
    ]

    expect(checkDeployTree(tree, limits)).toEqual({
      code: 413,
      status: 'failure',
      message: 'The file tree exceeds the deploy limit: 6 entries (maximum 5).'
    })
  })

  it('refuses one byte over the total, in binary megabytes', () => {
    const tree = [file('a.bin', 40), file('b.bin', 40), file('c.bin', 21)]

    expect(checkDeployTree(tree, limits)?.message).toBe(
      'The file tree exceeds the deploy limit: 101 bytes (maximum 100 bytes).'
    )

    expect(
      checkDeployTree([file('a.bin', 60 * 1024 * 1024)], DEPLOY_LIMITS)?.message
    ).toBe(
      'A file in the tree exceeds the deploy limit: a.bin is 60 MB (maximum 20 MB per file).'
    )
  })

  it('states the overage, so a tree just past the cap does not read as the cap', () => {
    // one byte over a 1 MB limit: rounding to nearest would print
    // "1 MB (maximum 1 MB)", a refusal that states no overage at all
    const oneMegabyte = 1024 * 1024

    expect(
      checkDeployTree([file('a.bin', oneMegabyte + 1)], {
        entries: 10,
        totalBytes: oneMegabyte,
        fileBytes: oneMegabyte
      })?.message
    ).toBe('The file tree exceeds the deploy limit: 1.1 MB (maximum 1 MB).')
  })

  it('refuses a tree nested past the depth the walk will enter', () => {
    // 32 nested folders put the leaf at level 33
    expect(checkDeployTree(nest(31), DEPLOY_LIMITS)).toBeNull()

    expect(checkDeployTree(nest(32), DEPLOY_LIMITS)).toEqual({
      code: 413,
      status: 'failure',
      message: 'The file tree is nested too deeply: 33 levels (maximum 32).'
    })
  })

  it('does not recurse into a tree deep enough to exhaust the stack', () => {
    // 100,000 nested folders would overflow the stack if the walk entered them;
    // it stops at MAX_DEPTH and refuses, which is what the route documents
    expect(() => checkDeployTree(nest(100000), DEPLOY_LIMITS)).not.toThrow()
    expect(checkDeployTree(nest(100000), DEPLOY_LIMITS)?.code).toBe(413)
  })

  it('refuses a single file over the per-file limit, naming it', () => {
    const tree = [folder('app', [file('big.bin', 41)])]

    expect(checkDeployTree(tree, limits)).toEqual({
      code: 413,
      status: 'failure',
      message:
        'A file in the tree exceeds the deploy limit: app/big.bin is 41 bytes (maximum 40 bytes per file).'
    })
  })

  it('refuses names before it judges size', () => {
    const tree = [
      folder('app', [service('../escape', 'x'), file('big.bin', 41)])
    ]

    expect(checkDeployTree(tree, limits)?.code).toBe(400)
    expect(checkDeployTree(tree, limits)?.message).toBe(
      "Invalid member name: '../escape.sas'. Member names must be single path segments (no '/', '\\', '..')."
    )
  })

  it('measures the whole tree even when a name is unsafe', () => {
    const tree = [
      service('ok', 'xxxx'),
      folder('nested', [file('a.bin', 10), service('../escape', 'yy')]),
      file('b.bin', 5)
    ]

    expect(measureDeployTree(tree)).toEqual({
      entries: 5,
      totalBytes: 21,
      largest: { path: 'nested/a.bin', bytes: 10 }
    })
  })

  it('measures a base64 file member by the bytes it writes', () => {
    // 'QUJD' is 'ABC': three bytes, not the four characters on the wire
    expect(
      measureDeployTree([{ name: 'a.txt', type: 'file', code: 'QUJD' }])
    ).toEqual({
      entries: 1,
      totalBytes: 3,
      largest: { path: 'a.txt', bytes: 3 }
    })
  })

  it('counts a service by its UTF-8 bytes, not its characters', () => {
    // two characters, four bytes
    expect(
      measureDeployTree([{ name: 's', type: 'service', code: 'éé' }]).totalBytes
    ).toBe(4)
  })

  it('decodes a base64 file body without a runtime helper', () => {
    expect(Array.from(decodeBase64('QUJD'))).toEqual([65, 66, 67])
    expect(Array.from(decodeBase64('QUJDRA=='))).toEqual([65, 66, 67, 68])
    expect(Array.from(decodeBase64(''))).toEqual([])
  })
})

describe('the tree shape', () => {
  it('accepts the wire format at every depth', () => {
    expect(
      isDeployTree({
        members: [
          {
            name: 'f',
            type: 'folder',
            members: [{ name: 's', type: 'service', code: '' }]
          },
          { name: 'x', type: 'file', code: '' }
        ]
      })
    ).toBe(true)
  })

  it.each([
    ['no members', {}],
    ['members not an array', { members: 'nope' }],
    ['a member without a name', { members: [{ type: 'file', code: '' }] }],
    ['a member of no known type', { members: [{ name: 'a', type: 'link' }] }],
    ['a service without code', { members: [{ name: 'a', type: 'service' }] }],
    [
      'a folder whose child is not a member',
      { members: [{ name: 'd', type: 'folder', members: [{ name: 'a' }] }] }
    ]
  ])('refuses %s', (_what, value) => {
    expect(isDeployTree(value)).toBe(false)
  })
})

describe('deploying', () => {
  const tree = [
    folder('services', [service('run', '%put hi;')]),
    { name: 'index.html', type: 'file', code: 'PGgxPkhlbGxvPC9oMT4=' }
  ]

  it('writes every member under the appLoc it names', async () => {
    const store = new MemoryDriveStore()

    await deployTree(store, '/Public/apps/demo', { members: tree })

    // a service is text, a file is the bytes its base64 stood for
    expect(store.dump()).toEqual({
      '/Public/apps/demo/services/run.sas': '%put hi;',
      '/Public/apps/demo/index.html': Uint8Array.from(
        Array.from('<h1>Hello</h1>', (char) => char.charCodeAt(0))
      )
    })
  })

  it('writes nothing when the cap refuses the tree', async () => {
    const store = new MemoryDriveStore()

    await expect(
      deployTree(
        store,
        '/Public/apps/big',
        { members: [file('a.bin', 41)] },
        limits
      )
    ).rejects.toMatchObject({ status: 413 })

    expect(store.dump()).toEqual({})
  })

  it('writes nothing when a name is unsafe', async () => {
    const store = new MemoryDriveStore()

    await expect(
      deployTree(
        store,
        '/Public/apps/hostile',
        { members: [service('ok', 'x'), service('../escape', 'y')] },
        limits
      )
    ).rejects.toMatchObject({ status: 400 })

    expect(store.dump()).toEqual({})
  })

  it('refuses an appLoc that resolves outside the drive', async () => {
    const store = new MemoryDriveStore()

    await expect(
      deployTree(store, '/../outside', { members: [] })
    ).rejects.toMatchObject({
      status: 400,
      message: 'appLoc cannot be outside drive.'
    })
  })

  it('carries the refusal envelope as its body', async () => {
    const store = new MemoryDriveStore()

    const error = await deployTree(store, '/Public/apps/bad', {
      members: 'nope'
    }).catch((caught) => caught)

    expect(isApiError(error)).toBe(true)
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).body).toEqual({
      status: 'failure',
      message: 'Provided not supported data format.'
    })
  })
})
