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
    expect(content.body).toBe('%put hi;')
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

    expect(answer.body).toBe('<html></html>')
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

    expect(content.body).toBe('%put second;')
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
