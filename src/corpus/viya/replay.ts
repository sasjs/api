/**
 * Replaying the Viya corpus against a host.
 *
 * The corpus (`VIYA_CORPUS`) is what the estate answered, as data, and both hosts
 * answer it: the package through its dispatcher and a server over HTTP, and a
 * browser host through its service worker. Keeping the replay here is what makes
 * that one implementation: a host supplies the ids its own answers handed out and
 * the values its own drive can use, and the corpus supplies everything else.
 *
 * What the corpus does NOT carry is the request: it records the answer's shape and
 * the names of the queries the client sent, because those are the contract. A
 * write's body is the caller's data, so a replay of a write is only as honest as
 * the host's own fixture - which is why `requestFor` reports a hole it cannot fill
 * instead of inventing one.
 */
import type { ViyaCase } from './operations.js'

/**
 * The identifiers a replay has collected, named by the segment they follow.
 *
 * `/compute/sessions/{}/jobs/{}` reads `sessions` then `jobs`, so the ids are
 * keyed that way rather than by position: a corpus case added later slots in
 * without the keys moving.
 */
export type ViyaReplayState = Record<string, string | undefined>

/** The segment a hole sits in, which is what names the id it takes. */
const KEY_BY_SEGMENT: Record<string, string> = {
  contexts: 'context',
  sessions: 'session',
  jobs: 'job',
  folders: 'folder',
  files: 'file',
  definitions: 'definition',
  variables: 'variable'
}

export interface ViyaReplayRequest {
  method: string
  /** The path with every hole this replay could fill replaced. */
  path: string
  /** Holes the state has no id for, as `segment` names - a request not yet answerable. */
  unresolved: string[]
  /** Query names the case records that the caller supplied no value for. */
  omittedQueries: string[]
}

/**
 * The request a captured case stands for, with `{}` filled from the ids a replay
 * has collected so far.
 *
 * A hole takes the id named by the segment before it (`/folders/folders/{}` is a
 * folder). A hole the state cannot fill is reported, not guessed: a path built
 * from a placeholder would answer a 404 that says nothing about the contract.
 */
export const requestFor = (
  viyaCase: ViyaCase,
  state: ViyaReplayState = {},
  queryValues: Record<string, string> = {}
): ViyaReplayRequest => {
  const [method, template] = viyaCase.route.split(' ')

  const unresolved: string[] = []

  return build(
    method,
    template.split('/'),
    viyaCase,
    state,
    queryValues,
    unresolved
  )
}

/** Segments back into the path, filling each hole from the state. */
const build = (
  method: string,
  segments: string[],
  viyaCase: ViyaCase,
  state: ViyaReplayState,
  queryValues: Record<string, string>,
  unresolved: string[]
): ViyaReplayRequest => {
  let previousSegment = ''

  const filled = segments.map((segment) => {
    if (segment !== '{}') {
      previousSegment = segment
      return segment
    }

    const key = KEY_BY_SEGMENT[previousSegment] ?? previousSegment
    const id = state[key]

    if (id === undefined) {
      unresolved.push(key)
      return '{}'
    }

    return id
  })

  let path = filled.join('/')

  const omittedQueries: string[] = []
  const params: string[] = []

  // encoded by hand rather than with `URLSearchParams`: this module is compiled
  // for the browser host as well as for node, and the package's build does not
  // carry the DOM types that class needs
  for (const name of viyaCase.queries) {
    const value = queryValues[name]

    if (value === undefined) omittedQueries.push(name)
    else params.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
  }

  if (params.length) path += (path.includes('?') ? '&' : '?') + params.join('&')

  return { method, path, unresolved, omittedQueries }
}

/**
 * Every place a captured shape and a body disagree, as readable strings.
 *
 * A shape's leaves are type names, so the comparison is on `typeof`; `'object'` is
 * the depth cap and means "an object, contents not recorded". Unlike an
 * assertion, this collects, so a host can report all the drift in one run instead
 * of stopping at the first key - and a body with an element shows its element's
 * shape, because an empty array proves nothing about it.
 */
export const shapeMismatches = (
  shape: unknown,
  body: unknown,
  where = 'body'
): string[] => {
  if (shape === 'object')
    return isRecord(body)
      ? []
      : [`${where}: expected an object, got ${typeName(body)}`]

  // `array` is a leaf the corpus really records (`properties: 'array'` on a job
  // definition), and `typeof` never yields it: an array is `object`. Without this
  // branch the comparison could never pass, and the message it produced -
  // "expected array, got array" - contradicted itself
  if (shape === 'array')
    return Array.isArray(body)
      ? []
      : [`${where}: expected an array, got ${typeName(body)}`]

  if (Array.isArray(shape)) {
    if (!Array.isArray(body))
      return [`${where}: expected an array, got ${typeName(body)}`]

    const first = body[0]

    // Neither side can say anything when the shape is empty: an empty answer
    // cannot demonstrate its element's shape, and an element shape the capture
    // recorded as `[]` is the absence of one. Comparing a real element against
    // `undefined` invents a drift - "expected undefined, got object" - that no
    // host could act on.
    return first === undefined || shape.length === 0
      ? []
      : shapeMismatches(shape[0], first, `${where}[0]`)
  }

  if (shape && typeof shape === 'object') {
    if (!isRecord(body))
      return [`${where}: expected an object, got ${typeName(body)}`]

    const record = body as Record<string, unknown>

    return Object.keys(shape as Record<string, unknown>).flatMap((key) =>
      key in record
        ? shapeMismatches(
            (shape as Record<string, unknown>)[key],
            record[key],
            `${where}.${key}`
          )
        : [`${where}.${key}: missing from the answer`]
    )
  }

  return typeof body === String(shape)
    ? []
    : [`${where}: expected ${String(shape)}, got ${typeName(body)}`]
}

const typeName = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value

/**
 * An object with named fields, which is what every captured shape describes.
 *
 * An array is `typeof object` in JavaScript, so a body of `[]` would otherwise be
 * compared as an object with no keys and reported as "missing every field" rather
 * than as the array it is.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
