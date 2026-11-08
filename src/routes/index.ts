/**
 * The route table, and the one matcher both hosts dispatch with.
 *
 * `GENERATED_ROUTES` is the OpenAPI document, `OVERLAY` is the part a document
 * cannot carry, and this file is where they meet. Importing it validates the
 * join as a side effect: an overlay entry naming an operation the document does
 * not have is a stale entry, and it throws here rather than being silently
 * ignored - the failure mode that lets a "documented" behaviour rot.
 */
import { GENERATED_ROUTES } from './generated.js'
import { OVERLAY, TAG_CAPABILITIES } from './overlay.js'
import type { Route, RouteResponse } from '../types.js'

const merge = (generated: (typeof GENERATED_ROUTES)[number]): Route => {
  const overlay = OVERLAY[generated.id]

  // Every operation states its decision. A route with no entry is a route
  // nobody has looked at, which reads exactly like a route that is about to be
  // done - so it fails the build instead, and the message says what to add.
  if (!overlay)
    throw new Error(
      `src/routes/overlay.ts has no entry for ${generated.id}. Every operation states whether this package implements it and, when it does not, the reason it does not: add \`{ implemented: false, reason: '...' }\` until a handler exists.`
    )

  const documented = new Map(
    generated.responses.map((r) => [r.status, r.description])
  )

  // The document states the statuses and the overlay only annotates the ones a
  // client keys a body on. Naming a status the document does not state is a
  // build failure: the alternative - listing it anyway - advertises a status
  // nothing can observe without the parity test failing, which is a documented
  // wish rather than a contract. A host that genuinely answers a status the
  // document omits needs the document corrected in sasjs/server.
  for (const status of Object.keys(overlay.responses || {}).map(Number)) {
    if (!documented.has(status)) {
      throw new Error(
        `src/routes/overlay.ts annotates status ${status} for ${generated.id}, which the OpenAPI document does not state. Correct the document in sasjs/server and re-vendor spec/swagger.yaml, or drop the annotation.`
      )
    }
  }

  const responses: RouteResponse[] = [...documented.keys()]
    .sort((a, b) => a - b)
    .map((status) => {
      const body = overlay.responses ? overlay.responses[status] : undefined
      return {
        status,
        description: documented.get(status) || '',
        ...(body === undefined ? {} : { body })
      }
    })

  // A host-only status has to be one the document states: the annotation marks
  // where a status is answered, it does not add one.
  for (const status of overlay.hostResponses || [])
    if (!documented.has(status))
      throw new Error(
        `src/routes/overlay.ts marks status ${status} of ${generated.id} as host-only, and the OpenAPI document does not state it. Correct the document in sasjs/server and re-vendor spec/swagger.yaml, or drop the annotation.`
      )

  return {
    ...generated,
    responses,
    hostResponses: overlay.hostResponses || [],
    capabilities: overlay.capabilities || TAG_CAPABILITIES[generated.tag] || [],
    implemented: overlay.implemented,
    ...(overlay.implemented ? {} : { reason: overlay.reason })
  }
}

export const ROUTES: Route[] = GENERATED_ROUTES.map(merge)

const known = new Set(ROUTES.map((route) => route.id))
for (const id of Object.keys(OVERLAY))
  if (!known.has(id))
    throw new Error(
      `src/routes/overlay.ts names an operation the OpenAPI document does not have: ${id}. Remove the entry or refresh spec/swagger.yaml.`
    )

const byId = new Map(ROUTES.map((route) => [route.id, route]))

/** The route with this `METHOD /path` identity, if the document has one. */
export const routeById = (id: string): Route | undefined => byId.get(id)

export interface RouteMatch {
  route: Route
  /** Values captured from the path's `{placeholders}`. */
  params: Record<string, string>
}

const escape = (segment: string) =>
  segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Compiles a documented path into a matcher. The table is static, so this runs
 * once at import; `findRoute` then tests exact paths first (most of the API is
 * static) and only falls through to the templates for `{uid}`-style paths.
 *
 * Both matchers ignore case in the path's static segments, because the host
 * does: express's `case sensitive routing` is off unless a server turns it on,
 * and `sasjs/server` does not, so `/SASjsApi/drive/fileTree` reaches the
 * handler documented as `filetree`. A matcher that compared the strings would
 * answer 404 for a request the server serves - and did: the server's own front
 * end calls the route with a capital T.
 *
 * The `i` flag applies to the static segments and to the parameter pattern; a
 * captured value keeps the case it was sent with, which is what a host needs to
 * look a user or a file up.
 */
const compiled = ROUTES.filter((route) => route.path.includes('{')).map(
  (route) => {
    const keys: string[] = []
    const pattern = route.path
      .split('/')
      .map((segment) => {
        if (segment.startsWith('{') && segment.endsWith('}')) {
          keys.push(segment.slice(1, -1))
          return '([^/]+)'
        }
        return escape(segment)
      })
      .join('/')
    return { route, keys, regex: new RegExp('^' + pattern + '/?$', 'i') }
  }
)

const exact = new Map<string, Route>()
for (const route of ROUTES)
  if (!route.path.includes('{'))
    exact.set(route.method + ' ' + route.path.toLowerCase(), route)

/**
 * The route a request names, or undefined when the API has no such operation.
 *
 * A host that gets undefined answers 404 "not part of the API"; a host that gets
 * a route it cannot serve answers 501 naming the capability. Keeping those two
 * apart is the difference between a client's bug and a host's limit.
 */
export const findRoute = (
  method: string,
  path: string
): RouteMatch | undefined => {
  const verb = method.toUpperCase()
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/'

  const hit = exact.get(verb + ' ' + clean.toLowerCase())
  if (hit) return { route: hit, params: {} }

  for (const candidate of compiled) {
    if (candidate.route.method !== verb) continue
    const match = candidate.regex.exec(clean)
    if (!match) continue
    const params: Record<string, string> = {}
    candidate.keys.forEach((key, index) => {
      try {
        params[key] = decodeURIComponent(match[index + 1])
      } catch {
        params[key] = match[index + 1]
      }
    })
    return { route: candidate.route, params }
  }

  return undefined
}
