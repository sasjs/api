import { VIYA_TABLE } from '../src/viya/table.js'
import { VIYA_OVERLAY } from '../src/viya/overlay.js'
import { dispatchViya } from '../src/viya/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { createIdentityService } from '../src/identity/service.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import { DEFAULT_IDENTITY } from '../src/identity/fixture.js'
import { EMULATED_CONTEXT_ID } from '../src/viya/compute.js'
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
  identity: createIdentityService(new MemoryIdentityStore(DEFAULT_IDENTITY)),
  viya: { serverUrl: 'http://localhost:5000' }
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
      'DELETE /compute/sessions/{}',
      'GET /files/files/{}',
      'GET /files/files/{}/content',
      'PATCH /files/files/{}',
      'POST /files/files',
      'PUT /files/files/{}/content',
      'GET /compute/contexts',
      'GET /compute/sessions/{}/jobs/{}',
      'GET /compute/sessions/{}/jobs/{}/log/content',
      'GET /compute/sessions/{}/jobs/{}/state',
      'GET /compute/sessions/{}/state',
      'POST /compute/contexts/{}/sessions',
      'POST /compute/sessions/{}/jobs',
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

/**
 * The compute family, held to its rows the same way.
 *
 * These are the answers a `serverType=SASVIYA` client cannot proceed without, so
 * a field the estate recorded and the emulator forgets is the difference between
 * a client that runs and one that throws.
 */
describe('the compute answers, against their captured shapes', () => {
  const withSession = async () => {
    const shared = services()
    const created = await dispatchViya(
      shared,
      'POST',
      `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
      { body: {} }
    )

    return { shared, created, id: (created.body as { id: string }).id }
  }

  it('answers the context list with every recorded key', async () => {
    const answer = await dispatchViya(services(), 'GET', '/compute/contexts', {
      query: { filter: "eq(name,'Mine')" }
    })

    assertShape(shapeOfRow('GET /compute/contexts'), answer.body, 'contexts')
  })

  it('answers a created session with every recorded key', async () => {
    const { created } = await withSession()

    expect(created.status).toBe(201)
    assertShape(
      shapeOfRow('POST /compute/contexts/{}/sessions'),
      created.body,
      'session'
    )
  })

  it('answers a submitted job with every recorded key', async () => {
    const { shared, id } = await withSession()
    const answer = await dispatchViya(
      shared,
      'POST',
      `/compute/sessions/${id}/jobs`,
      { body: { code: 'data a; run;', name: 'job' } }
    )

    expect(answer.status).toBe(201)
    assertShape(
      shapeOfRow('POST /compute/sessions/{}/jobs'),
      answer.body,
      'job'
    )
  })

  it('answers a job read back with every recorded key', async () => {
    const { shared, id } = await withSession()
    const submitted = await dispatchViya(
      shared,
      'POST',
      `/compute/sessions/${id}/jobs`,
      { body: { code: 'data a; run;' } }
    )
    const jobId = (submitted.body as { id: string }).id

    const answer = await dispatchViya(
      shared,
      'GET',
      `/compute/sessions/${id}/jobs/${jobId}`
    )

    assertShape(
      shapeOfRow('GET /compute/sessions/{}/jobs/{}'),
      answer.body,
      'job'
    )
  })

  it('answers a log with every recorded key', async () => {
    const { shared, id } = await withSession()
    const submitted = await dispatchViya(
      shared,
      'POST',
      `/compute/sessions/${id}/jobs`,
      { body: { code: 'data a; run;' } }
    )
    const jobId = (submitted.body as { id: string }).id

    const answer = await dispatchViya(
      shared,
      'GET',
      `/compute/sessions/${id}/jobs/${jobId}/log/content`
    )

    assertShape(
      shapeOfRow('GET /compute/sessions/{}/jobs/{}/log/content'),
      answer.body,
      'log'
    )
  })
})

/**
 * The file family, held to its rows.
 *
 * Three of the five carry the same recorded file body, so one upload is enough to
 * check them - and the content route records no shape, because its body is
 * whatever the file holds.
 */
describe('the file answers, against their captured shapes', () => {
  const uploaded = async () => {
    const shared = services()
    const folder = await dispatchViya(shared, 'POST', '/folders/folders', {
      query: { parentFolderUri: '' },
      body: { name: 'app' }
    })

    const answer = await dispatchViya(shared, 'POST', '/files/files', {
      query: { parentFolderUri: (folder.body as { id: string }).id },
      file: { name: 'program.sas', contents: 'data a; run;' }
    })

    return { shared, answer, id: (answer.body as { id: string }).id }
  }

  it('answers an upload with every recorded key', async () => {
    const { answer } = await uploaded()

    assertShape(shapeOfRow('POST /files/files'), answer.body, 'upload')
  })

  it('answers a file read back with every recorded key', async () => {
    const { shared, id } = await uploaded()
    const answer = await dispatchViya(shared, 'GET', `/files/files/${id}`)

    assertShape(shapeOfRow('GET /files/files/{}'), answer.body, 'file')
  })

  it('answers a rename with every recorded key', async () => {
    const { shared, id } = await uploaded()
    const answer = await dispatchViya(shared, 'PATCH', `/files/files/${id}`, {
      body: { name: 'renamed.sas' }
    })

    assertShape(shapeOfRow('PATCH /files/files/{}'), answer.body, 'rename')
  })

  it('answers a replace with every recorded key', async () => {
    const { shared, id } = await uploaded()
    const answer = await dispatchViya(
      shared,
      'PUT',
      `/files/files/${id}/content`,
      { file: { name: 'program.sas', contents: 'data b; run;' } }
    )

    assertShape(
      shapeOfRow('PUT /files/files/{}/content'),
      answer.body,
      'replace'
    )
  })
})
