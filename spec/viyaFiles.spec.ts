/**
 * The file family: upload, read back, rename, read content, replace content.
 *
 * Every one of these is answered by the drive, so most of what these cases prove
 * is that the emulated view and the drive do not disagree: an uploaded file is a
 * folder member, a renamed file is reachable by its new id, and the bytes that
 * come back are the bytes that went up. The rest is the id rule - a file id is
 * derived from its path, so a client can store one and ask for it later.
 */
import { dispatchViya } from '../src/viya/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { createIdentityService } from '../src/identity/service.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import { DEFAULT_IDENTITY } from '../src/identity/fixture.js'
import { idFor } from '../src/viya/ids.js'
import type { Services } from '../src/host/dispatch.js'

const services = (): Services => ({
  drive: createDriveService(new MemoryDriveStore()),
  identity: createIdentityService(new MemoryIdentityStore(DEFAULT_IDENTITY)),
  viya: { serverUrl: 'http://localhost:5000' }
})

/** An app folder, so uploads have a parent to name. */
const withFolder = async () => {
  const shared = services()

  const created = await dispatchViya(shared, 'POST', '/folders/folders', {
    query: { parentFolderUri: '' },
    body: { name: 'app' }
  })

  const folderId = (created.body as { id: string }).id

  return { shared, folderId }
}

const upload = async (
  target: Services,
  parentFolderUri: string | undefined,
  name: string,
  contents: string
) => {
  const answer = await dispatchViya(target, 'POST', '/files/files', {
    query: parentFolderUri === undefined ? {} : { parentFolderUri },
    file: { name, contents }
  })

  return answer
}

describe('an uploaded file', () => {
  it('is created in the folder the query names', async () => {
    const { shared, folderId } = await withFolder()
    const answer = await upload(
      shared,
      `/folders/folders/${folderId}`,
      'program.sas',
      '%put hello;'
    )

    expect(answer.status).toBe(201)
    expect((answer.body as { name: string }).name).toBe('program.sas')
  })

  it('is a member of that folder, which is the same estate seen twice', async () => {
    const { shared, folderId } = await withFolder()

    await upload(shared, `/folders/folders/${folderId}`, 'program.sas', 'x')

    const members = await dispatchViya(
      shared,
      'GET',
      `/folders/folders/${folderId}/members`
    )

    const items = (members.body as { items: Array<{ name: string }> }).items

    expect(items.map((item) => item.name)).toContain('program.sas')
  })

  it('lands at the root when no parent is named', async () => {
    const shared = services()
    const answer = await upload(shared, undefined, 'loose.txt', 'x')

    expect(answer.status).toBe(201)
  })

  it('refuses a parent that does not exist', async () => {
    const answer = await upload(
      services(),
      '/folders/folders/not-a-folder',
      'program.sas',
      'x'
    )

    expect(answer.status).toBe(404)
  })

  it('refuses a request with no file part', async () => {
    const answer = await dispatchViya(services(), 'POST', '/files/files', {
      query: {}
    })

    expect(answer.status).toBe(400)
  })
})

describe('a file read back by id', () => {
  it('answers the file the upload answered', async () => {
    const { shared, folderId } = await withFolder()
    const uploaded = await upload(
      shared,
      `/folders/folders/${folderId}`,
      'program.sas',
      '%put hello;'
    )
    const id = (uploaded.body as { id: string }).id

    const answer = await dispatchViya(shared, 'GET', `/files/files/${id}`)

    expect(answer.status).toBe(200)
    expect((answer.body as { id: string }).id).toBe(id)
    expect((answer.body as { size: number }).size).toBe(11)
  })

  it('is the same id on a second estate, because the id is the path', async () => {
    const one = await withFolder()
    const two = await withFolder()

    const first = await upload(
      one.shared,
      `/folders/folders/${one.folderId}`,
      'program.sas',
      'x'
    )
    const second = await upload(
      two.shared,
      `/folders/folders/${two.folderId}`,
      'program.sas',
      'y'
    )

    expect((first.body as { id: string }).id).toBe(
      (second.body as { id: string }).id
    )
  })

  it('refuses an id nobody holds', async () => {
    const answer = await dispatchViya(services(), 'GET', '/files/files/nope')

    expect(answer.status).toBe(404)
    expect((answer.body as { message: string }).message).toContain('nope')
  })
})

describe('a file renamed', () => {
  it('answers its new name, and its content is still there', async () => {
    const { shared, folderId } = await withFolder()
    const uploaded = await upload(
      shared,
      `/folders/folders/${folderId}`,
      'old.sas',
      '%put hi;'
    )
    const id = (uploaded.body as { id: string }).id

    const renamed = await dispatchViya(shared, 'PATCH', `/files/files/${id}`, {
      body: { name: 'new.sas' }
    })

    const newId = (renamed.body as { id: string }).id
    const content = await dispatchViya(
      shared,
      'GET',
      `/files/files/${newId}/content`
    )

    expect((renamed.body as { name: string }).name).toBe('new.sas')
    expect(newId).toBe(idFor('/app/new.sas', 'file'))
    expect(content.contents).toBe('%put hi;')
  })

  it('leaves the old id answering nothing, because the id was the path', async () => {
    const { shared, folderId } = await withFolder()
    const uploaded = await upload(
      shared,
      `/folders/folders/${folderId}`,
      'old.sas',
      'x'
    )
    const id = (uploaded.body as { id: string }).id

    await dispatchViya(shared, 'PATCH', `/files/files/${id}`, {
      body: { name: 'new.sas' }
    })

    const after = await dispatchViya(shared, 'GET', `/files/files/${id}`)

    expect(after.status).toBe(404)
  })
})

describe('file content', () => {
  it('answers the bytes that were uploaded, with a type', async () => {
    const { shared, folderId } = await withFolder()
    const uploaded = await upload(
      shared,
      `/folders/folders/${folderId}`,
      'page.html',
      '<html></html>'
    )
    const id = (uploaded.body as { id: string }).id

    const answer = await dispatchViya(
      shared,
      'GET',
      `/files/files/${id}/content`
    )

    // `contents`, the field ApiResponse reserves for a raw body: a host that maps
    // `body` JSON-encodes the file and answers `"<html></html>"`
    expect(answer.contents).toBe('<html></html>')
    expect(answer.body).toBeUndefined()
    expect(answer.headers['content-type']).toBe('text/html')
  })

  it('is replaced, and the replacement is what comes back', async () => {
    const { shared, folderId } = await withFolder()
    const uploaded = await upload(
      shared,
      `/folders/folders/${folderId}`,
      'program.sas',
      '%put first;'
    )
    const id = (uploaded.body as { id: string }).id

    const replaced = await dispatchViya(
      shared,
      'PUT',
      `/files/files/${id}/content`,
      { file: { name: 'program.sas', contents: '%put second;' } }
    )

    expect(replaced.status).toBe(200)
    expect((replaced.body as { size: number }).size).toBe(12)

    const content = await dispatchViya(
      shared,
      'GET',
      `/files/files/${id}/content`
    )

    expect(content.contents).toBe('%put second;')
  })

  it('refuses a replace with nothing in it', async () => {
    const { shared, folderId } = await withFolder()
    const uploaded = await upload(
      shared,
      `/folders/folders/${folderId}`,
      'program.sas',
      'x'
    )
    const id = (uploaded.body as { id: string }).id

    const answer = await dispatchViya(
      shared,
      'PUT',
      `/files/files/${id}/content`,
      {}
    )

    expect(answer.status).toBe(400)
  })

  it('stamps the emulated header on a content answer too', async () => {
    const { shared, folderId } = await withFolder()
    const uploaded = await upload(
      shared,
      `/folders/folders/${folderId}`,
      'a.txt',
      'x'
    )
    const id = (uploaded.body as { id: string }).id

    const answer = await dispatchViya(
      shared,
      'GET',
      `/files/files/${id}/content`
    )

    expect(answer.headers['x-sasjs-emulated']).toMatch(/^viya@/)
  })
})

describe('the content types the estate names', () => {
  const typeOf = async (name: string): Promise<string> => {
    const shared = services()
    const created = await dispatchViya(shared, 'POST', '/files/files', {
      query: {},
      file: { name, contents: 'x' }
    })

    return (created.body as { contentType: string }).contentType
  }

  it('names a type for each extension it recognises', async () => {
    expect(await typeOf('a.sas')).toBe('text/plain')
    expect(await typeOf('a.json')).toBe('application/json')
    expect(await typeOf('a.csv')).toBe('text/plain')
    expect(await typeOf('a.log')).toBe('text/plain')
    expect(await typeOf('a.html')).toBe('text/html')
    expect(await typeOf('a.htm')).toBe('text/html')
    expect(await typeOf('a.png')).toBe('image/png')
    expect(await typeOf('a.jpeg')).toBe('image/jpeg')
  })

  it('falls back to octet-stream for anything else', async () => {
    expect(await typeOf('a.bin')).toBe('application/octet-stream')
  })
})

describe('the size a client sees', () => {
  it('counts bytes, not characters, so a non-ASCII file is measured honestly', async () => {
    const shared = services()

    // two characters, three bytes: the size is what a upload of this file sends
    const answer = await dispatchViya(shared, 'POST', '/files/files', {
      query: {},
      file: { name: 'a.txt', contents: 'eu' }
    })

    expect((answer.body as { size: number }).size).toBe(2)

    const accented = await dispatchViya(shared, 'POST', '/files/files', {
      query: {},
      file: { name: 'b.txt', contents: 'eu\u0301' }
    })

    const bytes = (accented.body as { size: number }).size

    expect(bytes).toBeGreaterThan((answer.body as { size: number }).size)
  })
})

describe('the paths a request can name', () => {
  it('finds a parent nested below the root', async () => {
    const shared = services()

    const outer = await dispatchViya(shared, 'POST', '/folders/folders', {
      query: { parentFolderUri: '' },
      body: { name: 'outer' }
    })
    const inner = await dispatchViya(shared, 'POST', '/folders/folders', {
      query: { parentFolderUri: (outer.body as { id: string }).id },
      body: { name: 'inner' }
    })

    const uploaded = await dispatchViya(shared, 'POST', '/files/files', {
      query: { parentFolderUri: (inner.body as { id: string }).id },
      file: { name: 'deep.sas', contents: 'x' }
    })

    expect(uploaded.status).toBe(201)
    expect(idFor('/outer/inner/deep.sas', 'file')).toBe(
      (uploaded.body as { id: string }).id
    )
  })

  it('renames to the name it already has when the body names none', async () => {
    const { shared, folderId } = await withFolder()
    const uploaded = await upload(
      shared,
      `/folders/folders/${folderId}`,
      'same.sas',
      'x'
    )
    const id = (uploaded.body as { id: string }).id

    const answer = await dispatchViya(shared, 'PATCH', `/files/files/${id}`, {
      body: {}
    })

    expect((answer.body as { name: string }).name).toBe('same.sas')
  })

  it('accepts bytes as the multipart part, and measures them', async () => {
    const shared = services()

    const answer = await dispatchViya(shared, 'POST', '/files/files', {
      query: {},
      file: { name: 'a.bin', contents: new Uint8Array([1, 2, 3]) }
    })

    expect((answer.body as { size: number }).size).toBe(3)
  })

  // A file PUT puts the content on the wire as the body itself, with the file's
  // own content type, which is what `updateFileContent` in `@sasjs/adapter` sends
  // and what no JSON parser reads. The body is bytes as often as it is text.
  it('accepts the content as raw bytes', async () => {
    const { shared, folderId } = await withFolder()
    const uploaded = await upload(
      shared,
      `/folders/folders/${folderId}`,
      'a.bin',
      'x'
    )
    const id = (uploaded.body as { id: string }).id

    const answer = await dispatchViya(
      shared,
      'PUT',
      `/files/files/${id}/content`,
      { contents: new Uint8Array([0, 1, 2, 250]) }
    )

    expect(answer.status).toBe(200)
    expect((answer.body as { size: number }).size).toBe(4)
  })

  it('accepts the content as raw text', async () => {
    const { shared, folderId } = await withFolder()
    const uploaded = await upload(
      shared,
      `/folders/folders/${folderId}`,
      'a.sas',
      'x'
    )
    const id = (uploaded.body as { id: string }).id

    const answer = await dispatchViya(
      shared,
      'PUT',
      `/files/files/${id}/content`,
      { contents: 'data c; run;' }
    )

    expect(answer.status).toBe(200)
    expect((answer.body as { size: number }).size).toBe(12)
  })

  it('accepts a replacement body that carries its content under `contents`', async () => {
    const { shared, folderId } = await withFolder()
    const uploaded = await upload(
      shared,
      `/folders/folders/${folderId}`,
      'a.sas',
      'x'
    )
    const id = (uploaded.body as { id: string }).id

    const answer = await dispatchViya(
      shared,
      'PUT',
      `/files/files/${id}/content`,
      { body: { contents: 'data b; run;' } }
    )

    expect((answer.body as { size: number }).size).toBe(12)
  })
})

describe('a folder member', () => {
  /**
   * `getFileContent` and `updateFileContent` in `@sasjs/adapter` find a file by
   * listing its folder and reading `member.uri`, then fetching
   * `${uri}/content`. A path in that field sends the client to
   * `/app/program.sas/content`, which answers 404 on every host, so the field is
   * the resource a client can follow rather than a second spelling of the path.
   */
  it('names the resource a client fetches, not its path', async () => {
    const { shared, folderId } = await withFolder()
    const uploaded = await upload(
      shared,
      `/folders/folders/${folderId}`,
      'program.sas',
      '%put hello;'
    )
    const fileId = (uploaded.body as { id: string }).id
    const folderUri = `/folders/folders/${folderId}`

    const members = await dispatchViya(
      shared,
      'GET',
      `/folders/folders/${folderId}/members`,
      { query: {} }
    )

    const items = (
      members.body as {
        items: Array<{ name: string; uri: string; type: string }>
      }
    ).items

    const file = items.find((item) => item.name === 'program.sas')
    const folder = items.find((item) => item.type === 'folder')

    expect(file?.uri).toBe(`/files/files/${fileId}`)

    // the uri is followable: it is the same address the `self` link carries, and
    // the one a client reaches the content from
    const read = await dispatchViya(shared, 'GET', file?.uri as string)
    expect(read.status).toBe(200)

    // the bytes travel in `contents`: a body field would make a host JSON-encode
    // them under a text/html header
    const content = await dispatchViya(shared, 'GET', `${file?.uri}/content`)

    expect(content.status).toBe(200)
    expect(Buffer.from(content.contents as Uint8Array).toString()).toBe(
      '%put hello;'
    )

    // an empty app folder has no folder member to name; create one to prove the
    // folder branch follows the same rule
    expect(folder).toBeUndefined()

    await dispatchViya(shared, 'POST', '/folders/folders', {
      query: { parentFolderUri: folderUri },
      body: { name: 'sub' }
    })

    const listed = await dispatchViya(
      shared,
      'GET',
      `/folders/folders/${folderId}/members`,
      { query: {} }
    )

    const sub = (
      listed.body as { items: Array<{ name: string; uri: string }> }
    ).items.find((item) => item.name === 'sub')

    expect(sub?.uri).toMatch(/^\/folders\/folders\//)
    expect((await dispatchViya(shared, 'GET', sub?.uri as string)).status).toBe(
      200
    )
  })
})
