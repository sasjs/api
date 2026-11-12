/**
 * The one entry point for a Viya-shaped request.
 *
 * A host owns its transport - express on one side, a service worker on the other
 * - and this is where a Viya path becomes an answer. The table supplies the
 * operations, the overlay supplies the decision, the handlers supply the body,
 * and every answer leaves through one place so the emulated header cannot be
 * forgotten on the paths that are easiest to forget it: a refusal and a 404.
 *
 * A request for a path the table does not have is a 404 that says so, and it
 * carries the header like everything else - an emulated 404 must not be read as
 * evidence about Viya.
 */
import type { ApiRequest, ApiResponse, Services } from '../host/dispatch.js'
import { isApiError } from '../types.js'
import { VIYA_TABLE, type ViyaOperation } from './table.js'
import { VIYA_OVERLAY } from './overlay.js'
import { VIYA_HANDLERS } from './service.js'
import { emulatedHeaders } from './version.js'

/** An answer that states which contract produced it. */
export interface ViyaResponse extends ApiResponse {
  /** Always carries `x-sasjs-emulated`, including on a 404 and a 501. */
  headers: Record<string, string>
}

export interface ViyaMatch {
  operation: ViyaOperation
  /** The values the `{}` segments carried, in order. */
  segments: string[]
}

const escape = (segment: string) =>
  segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const compiled = VIYA_TABLE.filter((operation) =>
  operation.path.includes('{}')
).map((operation) => ({
  operation,
  pattern: new RegExp(
    '^' +
      operation.path
        .split('/')
        .map((segment) => (segment === '{}' ? '([^/]+)' : escape(segment)))
        .join('/') +
      '$'
  )
}))

const exact = new Map<string, ViyaOperation>()
for (const operation of VIYA_TABLE)
  if (!operation.path.includes('{}'))
    exact.set(`${operation.method} ${operation.path}`, operation)

/** The operation a request names, ignoring case in the static segments. */
export const findViyaOperation = (
  method: string,
  path: string
): ViyaMatch | undefined => {
  const verb = method.toUpperCase()
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/'
  const staticHit = exact.get(`${verb} ${clean}`)

  if (staticHit) return { operation: staticHit, segments: [] }

  for (const candidate of compiled) {
    if (candidate.operation.method !== verb) continue

    const match = candidate.pattern.exec(clean)

    if (match)
      return {
        operation: candidate.operation,
        segments: match.slice(1).map((segment) => {
          try {
            return decodeURIComponent(segment)
          } catch {
            return segment
          }
        })
      }
  }

  return undefined
}

/**
 * Answer a Viya request.
 *
 * `request` is the same shape the SASjs dispatch takes, so a host that already
 * resolves a caller - a session cookie - passes `subject` rather than a token.
 */
export const dispatchViya = async (
  services: Services,
  method: string,
  path: string,
  request: ApiRequest = {}
): Promise<ViyaResponse> => {
  const headers = emulatedHeaders()
  const found = findViyaOperation(method, path)

  if (!found)
    return {
      status: 404,
      headers,
      body: {
        version: 2,
        httpStatusCode: 404,
        errorCode: 404,
        message: `No operation is emulated at ${method.toUpperCase()} ${path}. The emulated estate answers the client's call surface and nothing else.`
      }
    }

  const entry = VIYA_OVERLAY[found.operation.id]

  if (!entry)
    // the overlay refuses to import unclassified rows, so reaching here is a
    // change that bypassed that check
    return {
      status: 501,
      headers,
      body: { message: `${found.operation.id} has no decision in the overlay.` }
    }

  if (!entry.implemented)
    return {
      status: 501,
      headers,
      body: {
        message:
          `${found.operation.id} is not emulated. ${entry.reason ?? ''}`.trim()
      }
    }

  const handler = VIYA_HANDLERS[found.operation.id]

  if (!handler)
    return {
      status: 501,
      headers,
      body: {
        message: `${found.operation.id} is marked implemented, but no handler answers it.`
      }
    }

  try {
    const answer = await handler({
      services,
      request,
      params: {
        id: found.segments[0],
        segments: found.segments
      } as unknown as Record<string, string>
    })

    return {
      ...answer,
      headers: { ...headers, ...(answer as ViyaResponse).headers }
    }
  } catch (error) {
    if (isApiError(error))
      return {
        status: error.status,
        headers,
        body: error.body ?? {
          version: 2,
          httpStatusCode: error.status,
          errorCode: error.status,
          message: error.message
        }
      }

    return {
      status: 500,
      headers,
      body: {
        version: 2,
        httpStatusCode: 500,
        errorCode: 500,
        message: String((error as Error)?.message ?? error)
      }
    }
  }
}
