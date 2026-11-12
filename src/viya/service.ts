/**
 * The Viya-shaped answers, built from the services the package already has.
 *
 * Each handler calls a port (`DriveService`, `IdentityService`) and returns the
 * shape the capture recorded for that operation - the shape is in
 * `src/viya/table.ts`, and the spec holds the two together. Nothing here
 * re-implements a rule the SASjs API side already decides: a folder that does not
 * exist is the drive's 404, and a path that climbs out of the root is the drive's
 * refusal.
 *
 * Identifiers are derived from the path rather than minted, so the same folder is
 * the same id on every host and every run. That is the seed rule applied to the
 * one thing the emulator cannot invent per request: a client stores a folder id
 * and asks for it later.
 */
import type { ApiResponse, Services } from '../host/dispatch.js'
import { ApiError } from '../types.js'
import type { DriveService } from '../drive/service.js'
import { COMPUTE_HANDLERS } from './compute.js'
import { FILE_HANDLERS } from './files.js'

import { idFor, normalisePath, EMULATED_NOW, EMULATED_USER } from './ids.js'

const linksFor = (uri: string, collection = false) => {
  const self = {
    href: uri,
    uri,
    rel: 'self',
    method: 'GET',
    type: 'application/vnd.sas.folder'
  }

  const members = {
    href: `${uri}/members`,
    uri: `${uri}/members`,
    rel: 'members',
    method: 'GET',
    type: 'application/vnd.sas.collection',
    itemType: 'folder'
  }

  // a collection answer leads with the collection link, which carries the
  // itemType its capture recorded
  return collection ? [members, self] : [self, members]
}

const folderBody = async (drive: DriveService, path: string) => {
  const listing = await drive.list(path)
  const id = idFor(path)

  const name = path.split('/').filter(Boolean).pop() ?? ''
  const parent = path.split('/').slice(0, -1).join('/') || '/'

  return {
    id,
    name,
    description: '',
    type: 'folder',
    version: 1,
    createdBy: EMULATED_USER.id,
    modifiedBy: EMULATED_USER.id,
    creationTimeStamp: EMULATED_NOW,
    modifiedTimeStamp: EMULATED_NOW,
    memberCount: listing.files.length + listing.folders.length,
    parentFolderUri: `/folders/folders/${idFor(parent)}`,
    links: linksFor(`/folders/folders/${id}`)
  }
}

const recycleBin = () => {
  const path = '@myRecycleBin'
  const id = idFor(path)

  return {
    id,
    name: 'Recycle Bin',
    description: 'Recycle Bin',
    type: 'trashFolder',
    version: 1,
    createdBy: EMULATED_USER.id,
    modifiedBy: EMULATED_USER.id,
    creationTimeStamp: EMULATED_NOW,
    modifiedTimeStamp: EMULATED_NOW,
    memberCount: 0,
    parentFolderUri: '',
    properties: { allowMove: 'false' },
    links: linksFor(`/folders/folders/${id}`)
  }
}

const requireDrive = (services: Services): DriveService => {
  if (!services.drive)
    throw new ApiError(
      501,
      'This host has no drive, so it cannot answer a folder operation.'
    )

  return services.drive
}

const pathFromQuery = (request: {
  query?: Record<string, string | undefined>
}) => {
  const path = request.query?.path

  if (!path) throw new ApiError(400, 'The path parameter is required.')

  return normalisePath(path)
}

/** The recycle-bin alias the emulator answers, which is also a valid parent. */
const RECYCLE_BIN_ALIAS = '/folders/folders/@myRecycleBin'

const isRecycleBin = (uri: string | undefined): boolean =>
  !!uri &&
  (uri === RECYCLE_BIN_ALIAS || uri.endsWith(`/${idFor('@myRecycleBin')}`))

/**
 * The path a folder id stands for, found by walking the drive.
 *
 * An id is derived from a path, so the drive is the index: a map would be a
 * second source of truth that goes stale the moment a folder is renamed or
 * moved - and would answer 404 for every id after a restart, which is the
 * opposite of "a client stores an id and asks for it later".
 */
const pathForId = async (drive: DriveService, id: string): Promise<string> => {
  const walk = (node: {
    isFolder: boolean
    relativePath: string
    children: unknown[]
  }): string | undefined => {
    if (node.isFolder && idFor(node.relativePath) === id)
      return node.relativePath

    for (const child of node.children as (typeof node)[]) {
      const hit = walk(child)

      if (hit) return hit
    }

    return undefined
  }

  const { tree } = await drive.tree('/')
  const path = walk(tree as never)

  if (!path)
    throw new ApiError(
      404,
      `No folder matches the id ${id}. Ids are derived from paths, so an id that names no folder is one no folder ever had.`
    )

  return path
}

/** The handlers, keyed by the operation id the table states. */
export const VIYA_HANDLERS: Record<
  string,
  (context: {
    services: Services
    request: {
      query?: Record<string, string | undefined>
      body?: unknown
      token?: string
      subject?: unknown
    }
    params: Record<string, string>
  }) => Promise<ApiResponse>
> = {
  'GET /identities/users/@currentUser': async ({ services, request }) => {
    const subject =
      (request.subject as { userId?: string } | undefined) ??
      (await services.identity?.authenticate(request.token))

    const id = subject?.userId ?? EMULATED_USER.id

    return {
      status: 200,
      body: {
        id,
        name: subject?.userId ?? EMULATED_USER.name,
        providerId: 'sas',
        state: 'active',
        version: 1,
        addresses: [],
        emailAddresses: [],
        links: [
          {
            href: `/identities/users/${id}`,
            uri: `/identities/users/${id}`,
            rel: 'self',
            method: 'GET',
            type: 'application/vnd.sas.identity.user'
          }
        ]
      }
    }
  },

  'GET /types/types': async () => ({
    status: 200,
    body: {
      count: 1,
      items: [
        {
          name: 'file',
          type: 'typeDef',
          version: 1,
          links: [{ href: '/types/types/file', rel: 'self', method: 'GET' }]
        }
      ]
    }
  }),

  'GET /folders/folders/@item': async ({ services, request }) => ({
    status: 200,
    body: await folderBody(requireDrive(services), pathFromQuery(request))
  }),

  'GET /folders/folders/@myRecycleBin': async () => ({
    status: 200,
    body: recycleBin()
  }),

  'GET /folders/folders/{}': async ({ services, params }) => {
    // the bin is addressed by id too, and it is not in the drive's tree
    if (params.id === idFor('@myRecycleBin'))
      return { status: 200, body: recycleBin() }

    const drive = requireDrive(services)

    return {
      status: 200,
      body: await folderBody(drive, await pathForId(drive, params.id))
    }
  },

  'GET /folders/folders/{}/members': async ({ services, params, request }) => {
    const drive = requireDrive(services)
    const limit = Number(request.query?.limit ?? 0) || 0

    // the bin is not a folder in the drive, and its own body advertises this
    // link - so a client following the answer it just received must not 404
    if (params.id === idFor('@myRecycleBin'))
      return {
        status: 200,
        body: {
          accept: 'application/json',
          name: 'members',
          start: 0,
          // the query value is echoed as the sibling branch echoes it: a caller
          // that asked for five and is told zero cannot tell what happened
          limit,
          count: 0,
          version: 2,
          items: [],
          links: linksFor(`/folders/folders/${idFor('@myRecycleBin')}`, true)
        }
      }

    const path = await pathForId(drive, params.id)
    const listing = await drive.list(path)

    const items = [
      ...listing.folders.map((name) => ({
        id: idFor(`${path}/${name}`.replace(/\/{2,}/g, '/')),
        name,
        type: 'folder',
        version: 1,
        createdBy: EMULATED_USER.id,
        modifiedBy: EMULATED_USER.id,
        creationTimeStamp: EMULATED_NOW,
        modifiedTimeStamp: EMULATED_NOW,
        parentFolderUri: `/folders/folders/${idFor(path)}`,
        uri: `${path}/${name}`.replace(/\/{2,}/g, '/'),
        links: linksFor(
          `/folders/folders/${idFor(`${path}/${name}`.replace(/\/{2,}/g, '/'))}`
        )
      })),
      ...listing.files.map((name) => ({
        id: idFor(`${path}/${name}`.replace(/\/{2,}/g, '/'), 'file'),
        name,
        type: 'file',
        version: 1,
        contentType: 'text/plain',
        createdBy: EMULATED_USER.id,
        modifiedBy: EMULATED_USER.id,
        creationTimeStamp: EMULATED_NOW,
        modifiedTimeStamp: EMULATED_NOW,
        parentFolderUri: `/folders/folders/${idFor(path)}`,
        added: EMULATED_NOW,
        uri: `${path}/${name}`.replace(/\/{2,}/g, '/'),
        links: linksFor(
          `/files/files/${idFor(`${path}/${name}`.replace(/\/{2,}/g, '/'), 'file')}`
        )
      }))
    ]

    const page = limit > 0 ? items.slice(0, limit) : items

    // the envelope is what the capture recorded, including the paging fields a
    // client reads to decide whether to ask for more
    return {
      status: 200,
      body: {
        accept: 'application/json',
        name: 'members',
        start: 0,
        limit: limit || page.length,
        count: page.length,
        version: 2,
        items: page,
        links: linksFor(`/folders/folders/${idFor(path)}`, true)
      }
    }
  },

  'POST /folders/folders': async ({ services, request }) => {
    const drive = requireDrive(services)
    const body = (request.body ?? {}) as {
      name?: string
      parentFolderUri?: string
    }

    if (!body.name) throw new ApiError(400, 'A folder name is required.')

    // the capture records the parent as a QUERY parameter, with the name in the
    // body: a handler that read the body alone put every folder at the root
    const parentUri = request.query?.parentFolderUri ?? body.parentFolderUri

    const parent = parentUri
      ? await pathForId(drive, String(parentUri).split('/').pop() as string)
      : '/'
    const path = normalisePath(`${parent}/${body.name}`)

    await drive.mkdir(path)

    return { status: 201, body: await folderBody(drive, path) }
  },

  'PATCH /folders/folders/{}': async ({ services, request, params }) => {
    const drive = requireDrive(services)
    if (params.id === idFor('@myRecycleBin'))
      throw new ApiError(400, 'The recycle bin cannot be moved or renamed.')

    const path = await pathForId(drive, params.id)
    const body = (request.body ?? {}) as {
      name?: string
      parentFolderUri?: string
    }

    // the adapter removes a folder by moving it to the recycle bin, which is the
    // shape the capture recorded for this verb. Both spellings arrive: the bin's
    // id, and the alias the emulator itself answers with
    if (isRecycleBin(body.parentFolderUri)) {
      const removed = await folderBody(drive, path)

      await drive.rmdir(path)

      // the answer describes the folder that was moved, not the drive root -
      // a client reads the id and parent from it
      return {
        status: 200,
        body: { ...removed, parentFolderUri: String(body.parentFolderUri) }
      }
    }

    // a move and a rename can arrive together, and an empty parent means the
    // root - the same value means the root on create, so reading it as "no
    // change" here was a second meaning for one string
    const name = body.name ?? path.split('/').pop()
    const parent =
      body.parentFolderUri === undefined
        ? path.split('/').slice(0, -1).join('/') || '/'
        : body.parentFolderUri === ''
          ? '/'
          : await pathForId(
              drive,
              body.parentFolderUri.split('/').pop() as string
            )

    const target = normalisePath(`${parent}/${name}`)

    if (target !== path) await drive.rename(path, target)

    return { status: 200, body: await folderBody(drive, target) }
  },

  ...COMPUTE_HANDLERS,

  ...FILE_HANDLERS
}
