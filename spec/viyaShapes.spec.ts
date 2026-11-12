import { VIYA_TABLE } from '../src/viya/table.js'
import { VIYA_OVERLAY } from '../src/viya/overlay.js'
import { dispatchViya } from '../src/viya/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { createIdentityService } from '../src/identity/service.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import { DEFAULT_IDENTITY } from '../src/identity/fixture.js'
import type { Services } from '../src/host/dispatch.js'

/**
 * Every implemented answer carries the keys its operation's capture recorded.
 *
 * The table is what an estate said, so a handler that omits a recorded field is
 * answering a client that reads it with nothing - and the omission is invisible
 * unless something walks the two together. This does, for every operation the
 * overlay says is implemented: a new handler, or a field dropped from an old
 * one, fails here rather than in a browser.
 */
const services = (): Services => ({
  drive: createDriveService(new MemoryDriveStore()),
  identity: createIdentityService(new MemoryIdentityStore(DEFAULT_IDENTITY))
})

const shapeOfRow = (id: string) =>
  VIYA_TABLE.find((operation) => operation.id === id)?.shape

/**
 * A captured shape, asserted against a body.
 *
 * The captured values are type names, so the assertion is on `typeof`; an
 * `object` is the depth cap and means "an object, contents not recorded"; an
 * empty array in the answer cannot demonstrate its element's shape, and says so
 * rather than passing silently.
 */
const assertShape = (shape: unknown, body: unknown, where: string): void => {
  if (shape === 'null') {
    expect(`${where}: ${body === null}`).toBe(`${where}: true`)

    return
  }

  if (shape === 'object') {
    expect(`${where}: ${typeof body}`).toBe(`${where}: object`)

    return
  }

  if (Array.isArray(shape)) {
    expect(`${where}: ${Array.isArray(body)}`).toBe(`${where}: true`)

    const first = (body as unknown[])[0]

    if (first !== undefined) assertShape(shape[0], first, `${where}[0]`)
    else console.log(`${where}: empty, so its element's shape is not shown`)

    return
  }

  if (shape && typeof shape === 'object') {
    expect(`${where}: ${typeof body}`).toBe(`${where}: object`)

    const record = body as Record<string, unknown>

    for (const key of Object.keys(shape)) {
      expect(`${where}.${key}: ${key in record}`).toBe(`${where}.${key}: true`)
      assertShape(
        (shape as Record<string, unknown>)[key],
        record[key],
        `${where}.${key}`
      )
    }

    return
  }

  expect(`${where}: ${typeof body}`).toBe(`${where}: ${String(shape)}`)
}

/** A drive with a folder holding a file, so member shapes have an element. */
const seeded = async () => {
  const shared = services()

  await dispatchViya(shared, 'POST', '/folders/folders', {
    query: { parentFolderUri: '' },
    body: { name: 'app' }
  })

  await shared.drive!.save('/app/notes.txt', 'hello')

  const item = await dispatchViya(shared, 'GET', '/folders/folders/@item', {
    query: { path: '/app' }
  })

  return { shared, id: (item.body as { id: string }).id }
}

describe('the answers and the shapes the captures recorded', () => {
  it('answers the current user with every recorded key', async () => {
    const answer = await dispatchViya(
      services(),
      'GET',
      '/identities/users/@currentUser'
    )

    assertShape(
      shapeOfRow('GET /identities/users/@currentUser'),
      answer.body,
      'user'
    )
  })

  it('answers a folder item with every recorded key', async () => {
    const { shared } = await seeded()

    const answer = await dispatchViya(shared, 'GET', '/folders/folders/@item', {
      query: { path: '/app' }
    })

    assertShape(shapeOfRow('GET /folders/folders/@item'), answer.body, 'item')
  })

  it('answers the recycle bin with every recorded key', async () => {
    const answer = await dispatchViya(
      services(),
      'GET',
      '/folders/folders/@myRecycleBin'
    )

    assertShape(
      shapeOfRow('GET /folders/folders/@myRecycleBin'),
      answer.body,
      'bin'
    )
  })

  it('answers a folder by id with every recorded key', async () => {
    // the capture reached this operation by id for the recycle bin, so that is
    // the answer whose shape it recorded
    const shared = services()
    const bin = await dispatchViya(
      shared,
      'GET',
      '/folders/folders/@myRecycleBin'
    )
    const binId = (bin.body as { id: string }).id

    const answer = await dispatchViya(
      shared,
      'GET',
      `/folders/folders/${binId}`
    )

    assertShape(shapeOfRow('GET /folders/folders/{}'), answer.body, 'byId')
  })

  it('answers a member list with the recorded envelope and item keys', async () => {
    const { shared, id } = await seeded()

    const answer = await dispatchViya(
      shared,
      'GET',
      `/folders/folders/${id}/members`,
      { query: { limit: '10' } }
    )

    assertShape(
      shapeOfRow('GET /folders/folders/{}/members'),
      answer.body,
      'members'
    )
  })

  it('answers a create with the recorded keys', async () => {
    const { shared } = await seeded()

    const answer = await dispatchViya(shared, 'POST', '/folders/folders', {
      query: { parentFolderUri: '' },
      body: { name: 'second' }
    })

    expect(answer.status).toBe(201)
    assertShape(shapeOfRow('POST /folders/folders'), answer.body, 'created')
  })

  it('answers a rename with the recorded keys', async () => {
    const { shared, id } = await seeded()

    const answer = await dispatchViya(
      shared,
      'PATCH',
      `/folders/folders/${id}`,
      {
        body: { name: 'renamed' }
      }
    )

    assertShape(shapeOfRow('PATCH /folders/folders/{}'), answer.body, 'patched')
  })

  it('covers every implemented operation, so no handler escapes the check', () => {
    const implemented = Object.entries(VIYA_OVERLAY)
      .filter(([, entry]) => entry.implemented)
      .map(([id]) => id)
      .sort()

    // the fixtures above name one operation each; this states which are missing
    // when a handler is added without one
    const covered = [
      'GET /folders/folders/@item',
      'GET /folders/folders/@myRecycleBin',
      'GET /folders/folders/{}',
      'GET /folders/folders/{}/members',
      'GET /identities/users/@currentUser',
      'GET /types/types',
      'PATCH /folders/folders/{}',
      'POST /folders/folders'
    ].sort()

    expect(implemented).toEqual(covered)
  })
})
