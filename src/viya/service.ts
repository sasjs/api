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

/** The emulated clock: a fixed instant, so a body is reproducible. */
export const EMULATED_NOW = '2026-01-01T00:00:00.000Z'

/** The caller the emulated estate reports when a host does not name one. */
export const EMULATED_USER = { id: 'emulated-user', name: 'Emulated User' }

/**
 * A uuid shape from a string, deterministically.
 *
 * Two 32-bit FNV-1a passes give enough of a hash to fill a uuid's fields, and the
 * version/variant nibbles are set so the result is a well-formed v4-shaped id.
 * Collisions are possible in principle and irrelevant here: the id is a handle
 * the emulator hands back, not a uniqueness guarantee.
 */
export const idFor = (path: string, kind = 'folder'): string => {
  const hash = (input: string, seed: number) => {
    let value = seed
    for (let index = 0; index < input.length; index++) {
      value ^= input.charCodeAt(index)
      value = Math.imul(value, 16777619) >>> 0
    }
    return value.toString(16).padStart(8, '0')
  }

  const raw =
    hash(`${kind}:${path}`, 2166136261) +
    hash(`${kind}:${path}`, 2246822519) +
    hash(`${kind}:${path}`, 3266489917) +
    hash(`${kind}:${path}`, 668265263)

  const hex = raw.slice(0, 32)

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32)
  ].join('-')
}

/** The path a folder id stands for, as this process has handed out. */
const pathsById = new Map<string, string>()

const linksFor = (uri: string) => [
  { href: uri, rel: 'self', method: 'GET', type: 'application/vnd.sas.folder' },
  {
    href: `${uri}/members`,
    rel: 'members',
    method: 'GET',
    type: 'application/vnd.sas.collection'
  }
]

const folderBody = async (drive: DriveService, path: string) => {
  const listing = await drive.list(path)
  const id = idFor(path)

  pathsById.set(id, path)

  const name = path.split('/').filter(Boolean).pop() ?? ''
  const parent = path.split('/').slice(0, -1).join('/') || '/'

  return {
    id,
    name,
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

  pathsById.set(id, path)

  return {
    id,
    name: 'Recycle Bin',
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

  return path
}

const pathFromId = (id: string): string => {
  const path = pathsById.get(id)

  if (!path)
    throw new ApiError(
      404,
      `No folder matches the id ${id}. The emulated estate hands out ids for paths it has answered for; a restart forgets them.`
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

  'GET /folders/folders/{}': async ({ services, params }) => ({
    status: 200,
    body: await folderBody(requireDrive(services), pathFromId(params.id))
  }),

  'GET /folders/folders/{}/members': async ({ services, params }) => {
    const drive = requireDrive(services)
    const path = pathFromId(params.id)
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
        links: linksFor(
          `/files/files/${idFor(`${path}/${name}`.replace(/\/{2,}/g, '/'), 'file')}`
        )
      }))
    ]

    return {
      status: 200,
      body: { accept: 'application/json', count: items.length, items }
    }
  },

  'POST /folders/folders': async ({ services, request }) => {
    const drive = requireDrive(services)
    const body = (request.body ?? {}) as {
      name?: string
      parentFolderUri?: string
    }

    if (!body.name) throw new ApiError(400, 'A folder name is required.')

    const parent = body.parentFolderUri
      ? pathFromId(body.parentFolderUri.split('/').pop() as string)
      : '/'
    const path = `${parent}/${body.name}`.replace(/\/{2,}/g, '/')

    await drive.mkdir(path)

    return { status: 201, body: await folderBody(drive, path) }
  },

  'PATCH /folders/folders/{}': async ({ services, request, params }) => {
    const drive = requireDrive(services)
    const path = pathFromId(params.id)
    const body = (request.body ?? {}) as {
      name?: string
      parentFolderUri?: string
    }

    // the adapter removes a folder by moving it to the recycle bin, which is the
    // shape the capture recorded for this verb
    if (body.parentFolderUri?.endsWith(`/${idFor('@myRecycleBin')}`)) {
      await drive.rmdir(path)

      return { status: 200, body: await folderBody(drive, '/') }
    }

    if (body.parentFolderUri) {
      const parent = pathFromId(body.parentFolderUri.split('/').pop() as string)
      const moved = `${parent}/${path.split('/').pop()}`

      await drive.rename(path, moved)

      return { status: 200, body: await folderBody(drive, moved) }
    }

    if (body.name) {
      const renamed = [...path.split('/').slice(0, -1), body.name].join('/')

      await drive.rename(path, renamed)

      return { status: 200, body: await folderBody(drive, renamed) }
    }

    return { status: 200, body: await folderBody(drive, path) }
  }
}
