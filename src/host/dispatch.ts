/**
 * One dispatcher, so the corpus can speak HTTP without a server.
 *
 * Both hosts own their transport - express with multer on one side, a service
 * worker reading `Request` objects on the other - and neither owns the
 * decisions. This file is the seam: it takes the request in the shape the
 * table describes and calls the service, and it is what the corpus runs
 * against.
 *
 * It also does the validation the table can express (a required parameter is
 * required), because repeating that list in each host is how the two answer
 * differently - the same failure the header seed and the webout block had.
 */
import type { Route } from '../types.js'
import { routeById } from '../routes/index.js'
import type { DriveService } from '../drive/service.js'
import { ApiError } from '../types.js'

export interface ApiRequest {
  query?: Record<string, string | undefined>
  body?: Record<string, unknown>
  /** The multipart payload: the API names it `file` on every route that takes one. */
  file?: { name: string; contents: string | Uint8Array }
}

export interface ApiResponse {
  status: number
  /** A JSON body. */
  body?: unknown
  /** A raw body, for the one route that answers with the file itself. */
  contents?: string | Uint8Array
}

export interface Services {
  drive: DriveService
}

/**
 * The parameters the table marks required, checked before the handler runs.
 *
 * Multipart fields are deliberately left to the handler: the payload carries the
 * file itself, and the server words a missing one as `"file" is not present.`
 * rather than `"file" is required` - a distinction a client may already key on.
 */
const validate = (route: Route, request: ApiRequest): void => {
  for (const param of route.params) {
    if (!param.required || param.in === 'formData' || param.in === 'header')
      continue
    // a path parameter comes from the matcher, not from the caller's payload, so
    // it is the host's job to have supplied it
    if (param.in === 'path') continue
    const given =
      param.in === 'query'
        ? request.query?.[param.name]
        : (request.body?.[param.name] as string | undefined)
    if (given === undefined || given === '')
      throw new ApiError(400, `"${param.name}" is required`)
  }
}

/** The drive path a write names: the query parameter wins over the form field. */
const targetPath = (request: ApiRequest): string => {
  const fromQuery = request.query?._filePath
  const fromBody = request.body?.filePath
  const path =
    fromQuery !== undefined
      ? String(fromQuery)
      : (fromBody as string | undefined)
  // neither given: the server's validation answers for the query parameter
  if (path === undefined) throw new ApiError(400, '"_filePath" is required')
  return path
}

export const dispatch = async (
  services: Services,
  routeId: string,
  request: ApiRequest = {}
): Promise<ApiResponse> => {
  const route = routeById(routeId)
  if (!route) throw new ApiError(404, `No such operation: ${routeId}`)
  validate(route, request)

  const { drive } = services
  const query = request.query || {}

  switch (routeId) {
    case 'GET /SASjsApi/drive/file': {
      const file = await drive.read(String(query._filePath || ''))
      return { status: 200, contents: file.contents }
    }
    case 'POST /SASjsApi/drive/file':
    case 'PATCH /SASjsApi/drive/file': {
      if (!request.file) throw new ApiError(400, '"file" is not present.')
      const path = targetPath(request)
      const result =
        routeId === 'PATCH /SASjsApi/drive/file'
          ? await drive.update(path, request.file.contents)
          : await drive.save(path, request.file.contents)
      return { status: 200, body: result }
    }
    case 'DELETE /SASjsApi/drive/file':
      return {
        status: 200,
        body: await drive.remove(String(query._filePath || ''))
      }

    case 'GET /SASjsApi/drive/folder':
      return { status: 200, body: await drive.list(query._folderPath) }

    case 'POST /SASjsApi/drive/folder':
      return {
        status: 200,
        body: await drive.mkdir(String(request.body?.folderPath || ''))
      }

    case 'DELETE /SASjsApi/drive/folder':
      return {
        status: 200,
        body: await drive.rmdir(String(query._folderPath || ''))
      }

    case 'POST /SASjsApi/drive/rename':
      return {
        status: 200,
        body: await drive.rename(
          String(request.body?.oldPath || ''),
          String(request.body?.newPath || '')
        )
      }

    case 'GET /SASjsApi/drive/filetree':
      return { status: 200, body: await drive.tree(query._folderPath) }

    default:
      throw new ApiError(501, `This package has no handler for ${routeId}.`)
  }
}

/** Whether a route is one `dispatch` can answer today. */
export const HANDLED_ROUTES: string[] = [
  'GET /SASjsApi/drive/file',
  'POST /SASjsApi/drive/file',
  'PATCH /SASjsApi/drive/file',
  'DELETE /SASjsApi/drive/file',
  'GET /SASjsApi/drive/folder',
  'POST /SASjsApi/drive/folder',
  'DELETE /SASjsApi/drive/folder',
  'POST /SASjsApi/drive/rename',
  'GET /SASjsApi/drive/filetree'
]
