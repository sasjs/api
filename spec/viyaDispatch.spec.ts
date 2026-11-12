import { VIYA_TABLE } from '../src/viya/table.js'
import { VIYA_OVERLAY } from '../src/viya/overlay.js'
import { VIYA_HANDLERS } from '../src/viya/service.js'
import { dispatchViya } from '../src/viya/dispatch.js'
import { emulatedHeaders } from '../src/viya/version.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { createIdentityService } from '../src/identity/service.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import { DEFAULT_IDENTITY } from '../src/identity/fixture.js'
import type { Services } from '../src/host/dispatch.js'

/**
 * Phase 1's first slice: the seam, proved end to end.
 *
 * The overlay must decide every operation the table states, every answer must
 * say which contract produced it, and the folder family must round-trip through
 * the drive the package already has - create, read back by path, list, remove.
 * Nothing here asserts a body the capture did not record, and nothing asserts a
 * shape by hand: `src/viya/table.ts` carries the captured shapes, and the
 * dispatch and the handlers are held to them by the operations they answer.
 */
const services = (): Services => ({
  drive: createDriveService(new MemoryDriveStore()),
  identity: createIdentityService(new MemoryIdentityStore(DEFAULT_IDENTITY))
})

const header = emulatedHeaders()

describe('the Viya overlay', () => {
  it('decides every operation the table states', () => {
    for (const operation of VIYA_TABLE) {
      expect(VIYA_OVERLAY[operation.id]).toBeTruthy()
      expect(typeof VIYA_OVERLAY[operation.id].implemented).toBe('boolean')
    }
  })

  it('decides nothing the table does not state', () => {
    const known = new Set(VIYA_TABLE.map((operation) => operation.id))

    for (const id of Object.keys(VIYA_OVERLAY)) expect(known.has(id)).toBe(true)
  })

  it('has a handler for every operation it says it implements', () => {
    const implemented = Object.entries(VIYA_OVERLAY)
      .filter(([, entry]) => entry.implemented)
      .map(([id]) => id)

    expect(implemented.sort()).toEqual(Object.keys(VIYA_HANDLERS).sort())
  })

  it('states a reason with every operation it declines', () => {
    for (const entry of Object.values(VIYA_OVERLAY))
      if (!entry.implemented)
        expect((entry.reason ?? '').length).toBeGreaterThan(30)
  })
})

describe('the Viya dispatch', () => {
  it('stamps the emulated header on an answer', async () => {
    const answer = await dispatchViya(services(), 'GET', '/types/types')

    expect(answer.status).toBe(200)
    expect(answer.headers).toEqual(header)
  })

  it('stamps it on a 404 for a path the table does not have', async () => {
    const answer = await dispatchViya(services(), 'GET', '/jobs/executions')

    expect(answer.status).toBe(404)
    expect(answer.headers).toEqual(header)
  })

  it('stamps it on a 501, and says why', async () => {
    const answer = await dispatchViya(services(), 'GET', '/compute/contexts')

    expect(answer.status).toBe(501)
    expect(answer.headers).toEqual(header)
    expect(String((answer.body as { message: string }).message)).toMatch(
      /compute/i
    )
  })

  it('reports the caller the host resolved', async () => {
    const answer = await dispatchViya(
      services(),
      'GET',
      '/identities/users/@currentUser',
      { subject: { userId: 'someone', clientId: 'sas.cli' } as never }
    )

    expect(answer.status).toBe(200)
    expect((answer.body as { id: string }).id).toBe('someone')
  })

  it('carries the header on an answer the drive refused', async () => {
    const answer = await dispatchViya(
      services(),
      'GET',
      '/folders/folders/@item',
      {
        query: { path: '/nowhere' }
      }
    )

    expect(answer.status).toBeGreaterThanOrEqual(400)
    expect(answer.headers).toEqual(header)
  })
})

describe('the folder family, through the drive', () => {
  const created = async () => {
    const shared = services()

    const answer = await dispatchViya(shared, 'POST', '/folders/folders', {
      query: { parentFolderUri: '' },
      body: { name: 'emulated' }
    })

    return { shared, answer }
  }

  it('creates a folder and answers with its body', async () => {
    const { answer } = await created()

    expect(answer.status).toBe(201)

    const body = answer.body as { id: string; name: string; type: string }

    expect(body.name).toBe('emulated')
    expect(body.type).toBe('folder')
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reads the same folder back by path, with the same id', async () => {
    const { shared, answer } = await created()
    const id = (answer.body as { id: string }).id

    const read = await dispatchViya(shared, 'GET', '/folders/folders/@item', {
      query: { path: '/emulated' }
    })

    expect(read.status).toBe(200)
    expect((read.body as { id: string }).id).toBe(id)
  })

  it('lists what the folder holds', async () => {
    const { shared, answer } = await created()
    const id = (answer.body as { id: string }).id

    const members = await dispatchViya(
      shared,
      'GET',
      `/folders/folders/${id}/members`
    )

    expect(members.status).toBe(200)
    expect((members.body as { count: number }).count).toBe(0)
  })

  it('removes a folder when the client moves it to the recycle bin', async () => {
    const { shared, answer } = await created()
    const id = (answer.body as { id: string }).id

    const bin = await dispatchViya(
      shared,
      'GET',
      '/folders/folders/@myRecycleBin'
    )
    const binId = (bin.body as { id: string }).id

    const moved = await dispatchViya(
      shared,
      'PATCH',
      `/folders/folders/${id}`,
      {
        body: { parentFolderUri: `/folders/folders/${binId}` }
      }
    )

    expect(moved.status).toBe(200)

    const gone = await dispatchViya(shared, 'GET', '/folders/folders/@item', {
      query: { path: '/emulated' }
    })

    expect(gone.status).toBeGreaterThanOrEqual(400)
  })

  it('derives an id from the path, so two hosts agree on it', async () => {
    const first = await dispatchViya(
      services(),
      'GET',
      '/folders/folders/@item',
      {
        query: { path: '/Public' }
      }
    )

    const second = await dispatchViya(
      services(),
      'GET',
      '/folders/folders/@item',
      {
        query: { path: '/Public' }
      }
    )

    expect((first.body as { id: string }).id).toBe(
      (second.body as { id: string }).id
    )
  })
})

describe('the refusals a host meets', () => {
  it('tells a host with no drive what it is missing, and still stamps the header', async () => {
    // a host always has a drive by type; the guard is for one that does not
    const answer = await dispatchViya(
      {} as unknown as Services,
      'GET',
      '/folders/folders/@item',
      { query: { path: '/Public' } }
    )

    expect(answer.status).toBe(501)
    expect(String((answer.body as { message: string }).message)).toMatch(
      /drive/i
    )
    expect(answer.headers).toEqual(header)
  })

  it('answers 404 for an id it has not handed out, and says why', async () => {
    const answer = await dispatchViya(
      services(),
      'GET',
      '/folders/folders/00000000-0000-4000-a000-000000000000'
    )

    expect(answer.status).toBe(404)
    expect(String((answer.body as { message: string }).message)).toMatch(/id/i)
  })

  it('answers 400 when the path parameter is missing', async () => {
    const answer = await dispatchViya(
      services(),
      'GET',
      '/folders/folders/@item'
    )

    expect(answer.status).toBe(400)
    expect(answer.headers).toEqual(header)
  })

  it('names the emulated user when the host resolves no caller', async () => {
    const answer = await dispatchViya(
      {} as unknown as Services,
      'GET',
      '/identities/users/@currentUser'
    )

    expect(answer.status).toBe(200)
    expect((answer.body as { id: string }).id).toBe('emulated-user')
  })
})

describe('the folder mutations the adapter performs', () => {
  const seeded = async () => {
    const shared = services()
    const { body } = await dispatchViya(shared, 'POST', '/folders/folders', {
      query: { parentFolderUri: '' },
      body: { name: 'app' }
    })

    return { shared, id: (body as { id: string }).id }
  }

  it('lists a file beside a folder', async () => {
    const { shared, id } = await seeded()

    await shared.drive!.save('/app/notes.txt', 'hello')

    const answer = await dispatchViya(
      shared,
      'GET',
      `/folders/folders/${id}/members`
    )

    expect(answer.status).toBe(200)

    const items = (
      answer.body as { items: Array<{ name: string; type: string }> }
    ).items

    expect(items.map((item) => item.name)).toEqual(['notes.txt'])
    expect(items[0].type).toBe('file')
  })

  it('renames a folder when the client sends a name', async () => {
    const { shared, id } = await seeded()

    const renamed = await dispatchViya(
      shared,
      'PATCH',
      `/folders/folders/${id}`,
      {
        body: { name: 'renamed' }
      }
    )

    expect(renamed.status).toBe(200)
    expect((renamed.body as { name: string }).name).toBe('renamed')

    const read = await dispatchViya(shared, 'GET', '/folders/folders/@item', {
      query: { path: '/renamed' }
    })

    expect(read.status).toBe(200)
  })

  it('moves a folder when the client sends a parent', async () => {
    const { shared, id } = await seeded()
    const parent = await dispatchViya(shared, 'POST', '/folders/folders', {
      query: { parentFolderUri: '' },
      body: { name: 'archive' }
    })
    const parentId = (parent.body as { id: string }).id

    const moved = await dispatchViya(
      shared,
      'PATCH',
      `/folders/folders/${id}`,
      {
        body: { parentFolderUri: `/folders/folders/${parentId}` }
      }
    )

    expect(moved.status).toBe(200)

    const read = await dispatchViya(shared, 'GET', '/folders/folders/@item', {
      query: { path: '/archive/app' }
    })

    expect(read.status).toBe(200)
  })

  it('answers the folder unchanged when the client sends neither', async () => {
    const { shared, id } = await seeded()

    const answer = await dispatchViya(
      shared,
      'PATCH',
      `/folders/folders/${id}`,
      {
        body: {}
      }
    )

    expect(answer.status).toBe(200)
    expect((answer.body as { id: string }).id).toBe(id)
  })
})

describe('the dispatch when its own furniture is missing', () => {
  afterEach(() => {
    jest.resetModules()
  })

  it('answers 501 when a row has no decision', async () => {
    const { VIYA_OVERLAY } = await import('../src/viya/overlay.js')
    const { dispatchViya } = await import('../src/viya/dispatch.js')
    const saved = VIYA_OVERLAY['GET /types/types']

    delete VIYA_OVERLAY['GET /types/types']

    try {
      const answer = await dispatchViya(services(), 'GET', '/types/types')

      expect(answer.status).toBe(501)
      expect(answer.headers).toEqual(header)
    } finally {
      VIYA_OVERLAY['GET /types/types'] = saved
    }
  })

  it('answers 501 when a row is implemented but nothing answers it', async () => {
    const { VIYA_HANDLERS } = await import('../src/viya/service.js')
    const { dispatchViya } = await import('../src/viya/dispatch.js')
    const saved = VIYA_HANDLERS['GET /types/types']

    delete VIYA_HANDLERS['GET /types/types']

    try {
      const answer = await dispatchViya(services(), 'GET', '/types/types')

      expect(answer.status).toBe(501)
      expect(String((answer.body as { message: string }).message)).toMatch(
        /no handler/i
      )
    } finally {
      VIYA_HANDLERS['GET /types/types'] = saved
    }
  })

  it('answers 500, with the header, when a handler throws something unexpected', async () => {
    const { VIYA_HANDLERS } = await import('../src/viya/service.js')
    const { dispatchViya } = await import('../src/viya/dispatch.js')
    const saved = VIYA_HANDLERS['GET /types/types']

    VIYA_HANDLERS['GET /types/types'] = async () => {
      throw new Error('a bug in a handler')
    }

    try {
      const answer = await dispatchViya(services(), 'GET', '/types/types')

      expect(answer.status).toBe(500)
      expect(answer.headers).toEqual(header)
    } finally {
      VIYA_HANDLERS['GET /types/types'] = saved
    }
  })
})

describe('the overlay and the table describe the same operations', () => {
  it('refuses an entry the table does not have, naming it', async () => {
    const { assertOverlayEntries } = await import('../src/viya/overlay.js')

    expect(() =>
      assertOverlayEntries({ 'GET /jobs/executions': { implemented: true } })
    ).toThrow(/GET \/jobs\/executions/)
  })

  it('refuses a captured operation with no decision, naming it', async () => {
    const { assertOverlayEntries } = await import('../src/viya/overlay.js')
    const { VIYA_TABLE } = await import('../src/viya/table.js')

    // a re-capture that adds an operation must not import cleanly and answer
    // 501 at run time
    expect(() => assertOverlayEntries({}, VIYA_TABLE)).toThrow(
      /no decision for GET \/compute\/contexts/
    )
  })
})

describe('a path segment that is not decodable', () => {
  it('keeps the raw segment rather than failing the match', async () => {
    const { findViyaOperation } = await import('../src/viya/dispatch.js')

    const match = findViyaOperation('GET', '/folders/folders/%E0%A4%A')

    expect(match?.operation.id).toBe('GET /folders/folders/{}')
    expect(match?.segments).toEqual(['%E0%A4%A'])
  })
})

describe('the small branches a caller can reach', () => {
  it('treats the root path as a path', async () => {
    const answer = await dispatchViya(services(), 'GET', '/')

    expect(answer.status).toBe(404)
    expect(answer.headers).toEqual(header)
  })

  it('quotes no reason when a declined row carries none', async () => {
    const { VIYA_OVERLAY } = await import('../src/viya/overlay.js')
    const { dispatchViya } = await import('../src/viya/dispatch.js')
    const saved = VIYA_OVERLAY['GET /compute/contexts']

    VIYA_OVERLAY['GET /compute/contexts'] = { implemented: false }

    try {
      const answer = await dispatchViya(services(), 'GET', '/compute/contexts')

      expect(answer.status).toBe(501)
      expect(String((answer.body as { message: string }).message)).toMatch(
        /is not emulated\.$/
      )
    } finally {
      VIYA_OVERLAY['GET /compute/contexts'] = saved
    }
  })

  it('reports a thrown non-Error as itself', async () => {
    const { VIYA_HANDLERS } = await import('../src/viya/service.js')
    const { dispatchViya } = await import('../src/viya/dispatch.js')
    const saved = VIYA_HANDLERS['GET /types/types']

    VIYA_HANDLERS['GET /types/types'] = async () => {
      throw 'a string, not an Error'
    }

    try {
      const answer = await dispatchViya(services(), 'GET', '/types/types')

      expect(answer.status).toBe(500)
      expect((answer.body as { message: string }).message).toBe(
        'a string, not an Error'
      )
    } finally {
      VIYA_HANDLERS['GET /types/types'] = saved
    }
  })
})

describe('a folder that holds a folder', () => {
  it('lists the child as a folder member, with its own id', async () => {
    const shared = services()

    await dispatchViya(shared, 'POST', '/folders/folders', {
      query: { parentFolderUri: '' },
      body: { name: 'app' }
    })

    const child = await dispatchViya(shared, 'POST', '/folders/folders', {
      body: {
        name: 'nested',
        parentFolderUri: `/folders/folders/${
          (
            await dispatchViya(shared, 'GET', '/folders/folders/@item', {
              query: { path: '/app' }
            })
          ).body &&
          (
            (
              await dispatchViya(shared, 'GET', '/folders/folders/@item', {
                query: { path: '/app' }
              })
            ).body as { id: string }
          ).id
        }`
      }
    })

    expect(child.status).toBe(201)

    const parentId = (
      (
        await dispatchViya(shared, 'GET', '/folders/folders/@item', {
          query: { path: '/app' }
        })
      ).body as { id: string }
    ).id

    const members = await dispatchViya(
      shared,
      'GET',
      `/folders/folders/${parentId}/members`
    )

    const items = (
      members.body as { items: Array<{ name: string; type: string }> }
    ).items

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'nested', type: 'folder' })
  })
})

describe('the root folder', () => {
  it('names it with an empty name and a root parent', async () => {
    const answer = await dispatchViya(
      services(),
      'GET',
      '/folders/folders/@item',
      {
        query: { path: '/' }
      }
    )

    expect(answer.status).toBe(200)

    const body = answer.body as { name: string; parentFolderUri: string }

    expect(body.name).toBe('')
    expect(body.parentFolderUri).toMatch(/^\/folders\/folders\//)
  })
})

describe('the folder refusals a client earns', () => {
  const seeded = async () => {
    const shared = services()

    await dispatchViya(shared, 'POST', '/folders/folders', {
      query: { parentFolderUri: '' },
      body: { name: 'app' }
    })

    const { body } = await dispatchViya(
      shared,
      'GET',
      '/folders/folders/@item',
      {
        query: { path: '/app' }
      }
    )

    return { shared, id: (body as { id: string }).id }
  }

  it('refuses a folder with no name', async () => {
    const answer = await dispatchViya(services(), 'POST', '/folders/folders', {
      query: { parentFolderUri: '' }
    })

    expect(answer.status).toBe(400)
    expect(answer.headers).toEqual(header)
  })

  it('answers a PATCH with no body with the folder as it stands', async () => {
    const { shared, id } = await seeded()

    const answer = await dispatchViya(shared, 'PATCH', `/folders/folders/${id}`)

    expect(answer.status).toBe(200)
    expect((answer.body as { id: string }).id).toBe(id)
  })
})

describe('the parent the client actually sends', () => {
  it('creates the folder under the parent named in the query, not the root', async () => {
    const shared = services()

    await dispatchViya(shared, 'POST', '/folders/folders', {
      query: { parentFolderUri: '' },
      body: { name: 'parent' }
    })

    const parent = await dispatchViya(shared, 'GET', '/folders/folders/@item', {
      query: { path: '/parent' }
    })
    const parentId = (parent.body as { id: string }).id

    // the capture records the parent as a query parameter, with the name in the
    // body - a handler reading only the body put every folder at the root
    const answer = await dispatchViya(shared, 'POST', '/folders/folders', {
      query: { parentFolderUri: `/folders/folders/${parentId}` },
      body: { name: 'child' }
    })

    expect(answer.status).toBe(201)

    const under = await dispatchViya(shared, 'GET', '/folders/folders/@item', {
      query: { path: '/parent/child' }
    })

    expect(under.status).toBe(200)
  })
})

describe('what a removal answers', () => {
  it('names the folder it removed, with the bin as its parent', async () => {
    const shared = services()

    await dispatchViya(shared, 'POST', '/folders/folders', {
      query: { parentFolderUri: '' },
      body: { name: 'doomed' }
    })

    const item = await dispatchViya(shared, 'GET', '/folders/folders/@item', {
      query: { path: '/doomed' }
    })
    const id = (item.body as { id: string }).id

    const removed = await dispatchViya(
      shared,
      'PATCH',
      `/folders/folders/${id}`,
      {
        body: { parentFolderUri: '/folders/folders/@myRecycleBin' }
      }
    )

    // the alias is a valid parent, and the answer is about the folder that moved
    expect(removed.status).toBe(200)
    expect((removed.body as { id: string }).id).toBe(id)
    expect((removed.body as { parentFolderUri: string }).parentFolderUri).toBe(
      '/folders/folders/@myRecycleBin'
    )
  })
})

describe('the static segments ignore case', () => {
  it('answers /Types/Types as /types/types does', async () => {
    const answer = await dispatchViya(services(), 'GET', '/Types/Types')

    expect(answer.status).toBe(200)
  })
})
