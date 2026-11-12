/**
 * The file family: upload, read back, rename, read content, replace content.
 *
 * Five operations, all answered by the drive the package already has, so nothing
 * here stores bytes of its own: an uploaded file is a file in the drive, and
 * reading it back is the drive's read. That is also what makes an upload visible
 * to the folder family - the same estate holds both views.
 *
 * A file id is derived from its path, like a folder id: a client stores the id an
 * upload answered and asks for it later, so the id cannot move between runs.
 */
import type { ApiResponse, Services } from '../host/dispatch.js'
import { ApiError } from '../types.js'
import type { DriveService } from '../drive/service.js'
import type { TreeNode } from '../types.js'
import { EMULATED_NOW, EMULATED_USER, idFor } from './ids.js'

/** What an upload answers about itself, whichever operation asked. */
export interface EmulatedFile {
  name: string
  path: string
  size: number
}

const contentTypeOf = (name: string): string => {
  if (/\.sas$/i.test(name)) return 'text/plain'
  if (/\.(json)$/i.test(name)) return 'application/json'
  if (/\.(csv|txt|log)$/i.test(name)) return 'text/plain'
  if (/\.(html?)$/i.test(name)) return 'text/html'
  if (/\.(png)$/i.test(name)) return 'image/png'
  if (/\.(jpe?g)$/i.test(name)) return 'image/jpeg'

  return 'application/octet-stream'
}

/**
 * What the estate records about a file.
 *
 * `properties` carries the five keys the capture recorded, with the values a
 * client reads rather than placeholders: the three `content.*` flags say what can
 * be done with the file, and `typeRegistrant` says who registered the type.
 */
const fileBody = (file: EmulatedFile) => {
  const id = idFor(file.path, 'file')
  const uri = `/files/files/${id}`
  const contentType = contentTypeOf(file.name)

  return {
    id,
    name: file.name,
    contentType,
    contentDisposition: `attachment; filename="${file.name}"`,
    encoding: 'UTF-8',
    size: file.size,
    fileStatus: 'complete',
    fileVersion: 1,
    version: 2,
    typeDefName: 'file',
    createdBy: EMULATED_USER.id,
    modifiedBy: EMULATED_USER.id,
    creationTimeStamp: EMULATED_NOW,
    modifiedTimeStamp: EMULATED_NOW,
    quarantine: false,
    searchable: true,
    virusDetected: false,
    urlDetected: false,
    properties: {
      'content.download': 'true',
      'content.openInBrowser': 'true',
      'content.preview': 'false',
      sasIconKey: 'file',
      typeRegistrant: EMULATED_USER.id
    },
    links: [
      {
        href: uri,
        uri,
        rel: 'self',
        method: 'GET',
        type: 'application/vnd.sas.file'
      },
      {
        href: `${uri}/content`,
        uri: `${uri}/content`,
        rel: 'content',
        method: 'GET',
        type: 'application/vnd.sas.file.content'
      }
    ]
  }
}

const sizeOf = (contents: string | Uint8Array): number =>
  typeof contents === 'string'
    ? Buffer.byteLength(contents, 'utf-8')
    : contents.byteLength

/** Every file in the drive, as `path` and name. */
const filesIn = async (drive: DriveService): Promise<EmulatedFile[]> => {
  const walk = (node: TreeNode, found: EmulatedFile[]): EmulatedFile[] => {
    if (!node.isFolder)
      found.push({ name: node.name, path: node.relativePath, size: 0 })

    for (const child of node.children) walk(child, found)

    return found
  }

  return walk((await drive.tree('/')).tree, [])
}

/**
 * The path a file id names, or the 404 a client with a stale id expects.
 *
 * Resolved against the drive rather than remembered in a map: a rename changes the
 * path and therefore the id, and a map would keep answering for the old one.
 */
const pathForFileId = async (
  drive: DriveService,
  id: string
): Promise<string> => {
  const file = (await filesIn(drive)).find(
    (candidate) => idFor(candidate.path, 'file') === id
  )

  if (!file) throw new ApiError(404, `File with ID '${id}' was not found.`)

  return file.path
}

const bodyOf = async (
  drive: DriveService,
  path: string
): Promise<EmulatedFile> => {
  const read = await drive.read(path)

  return {
    name: path.split('/').pop() as string,
    path,
    size: sizeOf(read.contents)
  }
}

/** The parent folder a request names, or the root it means by its absence. */
const parentOf = async (
  drive: DriveService,
  uri: string | undefined
): Promise<string> => {
  if (!uri) return '/'

  const id = uri.split('/').pop() as string
  const tree = await drive.tree('/')

  const walk = (node: {
    relativePath: string
    isFolder: boolean
    children: unknown[]
  }): string | undefined => {
    if (node.isFolder && idFor(node.relativePath, 'folder') === id)
      return node.relativePath

    for (const child of node.children as (typeof node)[]) {
      const hit = walk(child)

      if (hit !== undefined) return hit
    }

    return undefined
  }

  const found = walk(tree.tree)

  if (found === undefined)
    throw new ApiError(404, `Folder with ID '${id}' was not found.`)

  return found
}

export const FILE_HANDLERS: Record<
  string,
  (context: {
    services: Services
    request: {
      query?: Record<string, string | undefined>
      body?: unknown
      file?: { name: string; contents: string | Uint8Array }
      token?: string
      subject?: unknown
    }
    params: Record<string, string>
  }) => Promise<ApiResponse>
> = {
  'POST /files/files': async ({ services, request }) => {
    const drive = requireDrive(services)
    const upload = request.file

    if (!upload?.name)
      throw new ApiError(400, 'A file named `file` is required.')

    const parent = await parentOf(drive, request.query?.parentFolderUri)
    const path = `${parent}/${upload.name}`.replace(/\/{2,}/g, '/')

    await drive.save(path, upload.contents)

    return { status: 201, body: fileBody(await bodyOf(drive, path)) }
  },

  'GET /files/files/{}': async ({ services, params }) => {
    const drive = requireDrive(services)
    const path = await pathForFileId(drive, params.id)

    return { status: 200, body: fileBody(await bodyOf(drive, path)) }
  },

  'PATCH /files/files/{}': async ({ services, params, request }) => {
    const drive = requireDrive(services)
    const path = await pathForFileId(drive, params.id)
    const body = (request.body ?? {}) as { name?: string }

    const name = body.name ?? (path.split('/').pop() as string)
    const target = `${path.split('/').slice(0, -1).join('/')}/${name}`.replace(
      /\/{2,}/g,
      '/'
    )

    if (target !== path) await drive.rename(path, target)

    return { status: 200, body: fileBody(await bodyOf(drive, target)) }
  },

  'GET /files/files/{}/content': async ({ services, params }) => {
    const drive = requireDrive(services)
    const path = await pathForFileId(drive, params.id)
    const read = await drive.read(path)

    // the estate answers the bytes, and the shape is whatever the file holds -
    // the capture recorded no JSON shape because there is none
    return {
      status: 200,
      body: read.contents,
      headers: {
        'content-type': contentTypeOf(path.split('/').pop() as string)
      }
    }
  },

  'PUT /files/files/{}/content': async ({ services, params, request }) => {
    const drive = requireDrive(services)
    const path = await pathForFileId(drive, params.id)

    // a host may hand the bytes over as the multipart part or as the body
    const body = request.body as unknown

    const contents =
      request.file?.contents ??
      (typeof body === 'string'
        ? body
        : (body as { contents?: string } | undefined)?.contents)

    if (contents === undefined || contents === null)
      throw new ApiError(400, 'File content is required.')

    await drive.update(path, contents as string | Uint8Array)

    return { status: 200, body: fileBody(await bodyOf(drive, path)) }
  }
}

/**
 * The drive. It is required on `Services`, so there is no absent case to answer:
 * a host that mounts the emulator has one, and a branch for the other would be a
 * branch nothing can reach.
 */
const requireDrive = (services: Services): DriveService => services.drive
