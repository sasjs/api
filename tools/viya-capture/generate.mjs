/**
 * Turns a capture into the emulator's table and corpus.
 *
 * The capture is what the adapter sent to an estate and what the estate
 * answered. Two rules decide what survives into the generated files:
 *
 * - **structure, never values.** A path keeps its shape (`/folders/folders/{}`),
 *   a query keeps its parameter names, a body becomes a type sketch. A capture
 *   names a real folder, a real user and real ids, and none of that belongs in a
 *   repository - the emulator generates its data from a seed, so the table only
 *   has to say what SHAPE arrives.
 * - **stable order, so the diff is reviewable.** Operations sort by path then
 *   verb; keys sort by name.
 *
 * A step whose requests were all refusals is still an operation, and a step that
 * recorded nothing at all is dropped rather than guessed: `recorded: false` with
 * a reason is the honest form, and the table states it.
 */

/**
 * Whether one observed row describes the operation better than another.
 *
 * A success beats a refusal, because a refusal in the middle of a pass is a fact
 * about that run. Two successes are equal on status, so the one carrying a body
 * wins - the shape is the part a host has to reproduce.
 */
const isBetterRow = (current, candidate) => {
  if (candidate.expected === undefined) return false
  if (current.expected === undefined) return true

  const currentSuccess = isSuccess(current.expected)
  const candidateSuccess = isSuccess(candidate.expected)

  if (candidateSuccess !== currentSuccess) return candidateSuccess

  return current.shape === undefined && candidate.shape !== undefined
}

/** Whether a status is one the client treats as a successful answer. */
const isSuccess = (status) =>
  typeof status === 'number' && status >= 200 && status < 300

/** A path segment that is an identifier rather than a name. */
const ID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-ses\d+)?$/i

/** A segment Viya uses for a well-known item, which is a name, not an id. */
const isId = (segment) =>
  ID_SEGMENT.test(segment) || /^[0-9a-f]{24,}$/i.test(segment)

/** `/folders/folders/3f2.../members` -> `/folders/folders/{}/members` */
export const pathOf = (path) =>
  path
    .split('/')
    .map((segment) => (isId(segment) ? '{}' : segment))
    .join('/')

/** The parameter names, sorted - a value in a query is estate data. */
export const queryOf = (query) => (query ? Object.keys(query).sort() : [])

const typeOf = (value) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * A body as a type sketch: keys with types, arrays as their first element's
 * shape, and values never.
 *
 * Depth is bounded because a Viya body nests folders, links and properties
 * several levels deep, and a table that reproduced all of it would be a copy of
 * one estate's answer with the values filed off.
 */
export const shapeOf = (value, depth = 0) => {
  if (value === null || value === undefined) return 'null'

  if (Array.isArray(value)) {
    const first = value.find((entry) => entry !== null && entry !== undefined)

    // an array does not consume a level: `links: [{ href, rel }]` is the most
    // useful part of a Viya body, and counting the array against the depth cap
    // hid it behind 'object'
    return first === undefined ? 'array' : [shapeOf(first, depth)]
  }

  const type = typeOf(value)

  if (type !== 'object') return type

  if (depth >= 3) return 'object'

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, shapeOf(value[key], depth + 1)])
  )
}

/**
 * The shape of the body the client sent.
 *
 * Three encodings reach a Viya endpoint and each says something different about
 * what the call carries. A JSON body is a type sketch. A urlencoded body is its
 * parameter names, the way a query is - values are estate data. A multipart body
 * is the part names from its `name="..."` headers, which is how the adapter
 * posts a refresh. Anything else is undefined, and the table says so rather than
 * claiming the client sent nothing.
 */
const requestShape = (entry) => {
  const body = entry.request?.body

  if (typeof body !== 'string' || !body.trim()) return undefined

  const trimmed = body.trim()
  const contentType = String(entry.request?.headers?.['content-type'] ?? '')

  if (trimmed.startsWith('{')) {
    try {
      return shapeOf(JSON.parse(trimmed))
    } catch {
      return undefined
    }
  }

  if (contentType.includes('multipart/form-data')) {
    // anchored on the disposition parameter: a bare `name="..."` also matches
    // the `name=` inside `filename="..."`, which would put an uploaded file's
    // own name - a value, with the run's timestamp in it - into the table as a
    // part the client never sends
    const names = [...trimmed.matchAll(/(?:^|;\s*)name="([^"]+)"/g)].map(
      (match) => match[1]
    )

    return names.length ? { multipart: [...new Set(names)].sort() } : undefined
  }

  if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(trimmed))
    return {
      form: trimmed
        .split('&')
        .map((pair) => pair.split('=')[0])
        .filter(Boolean)
        .sort()
    }

  return undefined
}

/** A JSON body, when the response carried one. */
const bodyShape = (entry) => {
  const body = entry.response?.body

  if (typeof body !== 'string' || !body.trim().startsWith('{')) return undefined

  try {
    return shapeOf(JSON.parse(body))
  } catch {
    return undefined
  }
}

/**
 * The operations a capture describes.
 *
 * One step can be several requests - a file create is three - so the operation
 * is keyed by `METHOD /path` and the step only says which scripted pass produced
 * it. A path that arrives with two verbs is two operations, because a route
 * table matches on both.
 */
export const operationsOf = (capture) => {
  const operations = new Map()

  for (const entry of capture.steps) {
    const method = entry.request?.method
    const path = entry.request?.path

    if (!method || !path) continue

    // the recorder's own tidying up is not the client's surface
    if (entry.cleanup) continue

    const id = `${method} ${pathOf(path)}`

    if (!operations.has(id))
      operations.set(id, {
        id,
        method,
        path: pathOf(path),
        steps: new Set(),
        statuses: new Set(),
        queries: new Set(),
        requestQueries: new Set(),
        requestBody: undefined,
        response: undefined,
        expected: undefined
      })

    const operation = operations.get(id)

    operation.steps.add(entry.step)
    if (typeof entry.response?.status === 'number')
      operation.statuses.add(entry.response.status)

    for (const name of queryOf(entry.request.query)) {
      operation.queries.add(name)
      // the request is one observed call per row, but the parameter names are
      // the union of what the client sent: a handler built from one row's names
      // would omit a parameter, and nothing would say it was partial
      operation.requestQueries.add(name)
    }

    // the first successful answer is the one worth sketching: a 401 in the
    // middle of a pass is a fact about that run, not about the operation.
    // Success is the whole 2xx range - a create answers 201 and a delete 204,
    // and a test for exactly 200 recorded the refusal in front of it.
    if (
      !operation.response ||
      (!isSuccess(operation.response.status) &&
        isSuccess(entry.response?.status))
    ) {
      operation.response = {
        status: entry.response?.status,
        shape: bodyShape(entry)
      }
      operation.expected = entry.response?.status
      operation.requestBody = requestShape(entry)
    }
  }

  return [...operations.values()]
    .map((operation) => ({
      id: operation.id,
      method: operation.method,
      path: operation.path,
      steps: [...operation.steps].sort(),
      statuses: [...operation.statuses].sort((a, b) => a - b),
      queries: [...operation.queries].sort(),
      request: {
        queries: [...operation.requestQueries].sort(),
        body: operation.requestBody
      },
      shape: operation.response?.shape,
      expected: operation.expected
    }))
    .sort((a, b) =>
      a.path === b.path
        ? a.method.localeCompare(b.method)
        : a.path.localeCompare(b.path)
    )
}

/** A JSON literal, indented the way the generated files are. */
const literal = (value, indent = 0) => {
  const pad = '  '.repeat(indent)

  if (value === undefined) return 'undefined'

  if (Array.isArray(value))
    return value.length === 0
      ? '[]'
      : `[\n${value.map((entry) => `${pad}  ${literal(entry, indent + 1)}`).join(',\n')}\n${pad}]`

  if (value && typeof value === 'object')
    return `{\n${Object.keys(value)
      // a shape key comes from a JSON body, so it can be `content-type` or
      // `_links` - emitted bare, the first is not TypeScript
      .map(
        (key) =>
          `${pad}  ${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${literal(value[key], indent + 1)}`
      )
      .join(',\n')}\n${pad}}`

  return JSON.stringify(value)
}

const HEADER = (version, what) => `/**
 * ${what}
 *
 * Generated by \`npm run sync:viya\` from a capture taken against Viya
 * ${version}. Do not edit by hand: the capture is the evidence, and a change
 * here that the capture does not support is a claim nobody can check.
 *
 * Values never reach this file. A path keeps its shape with \`{}\` for a segment
 * that was an identifier, a query keeps its parameter names, and a body is a
 * type sketch - the emulator generates its data from a seed, so the shape is all
 * the table needs.
 */
`

/** `src/viya/table.ts` from the operations a capture describes. */
export const renderTable = (operations, version) =>
  HEADER(
    version,
    'The Viya route table: every operation the capture observed.'
  ) +
  `
import type { HttpMethod } from '../types.js'

export interface ViyaOperation {
  /** \`METHOD /path\`, which is what a route table matches. */
  id: string
  method: HttpMethod
  /** \`{}\` is one path segment that was an identifier in the capture. */
  path: string
  /** The scripted pass that produced it, so a reader can find the step. */
  steps: string[]
  /** Every status the estate answered with, as observed. */
  statuses: number[]
  /** Query parameter names the client sent. Values are estate data. */
  queries: string[]
  /**
   * The request the client built: its query names, and its body's shape - a
   * type sketch for JSON, parameter names for a form or multipart body, and
   * undefined only where nothing could be read.
   */
  request?: { queries: string[]; body?: unknown }
  /** The body shape of the answer a client keys on. */
  shape?: unknown
}

export const VIYA_TABLE: ViyaOperation[] = ${literal(
    operations.map((operation) => ({
      id: operation.id,
      method: operation.method,
      path: operation.path,
      steps: operation.steps,
      statuses: operation.statuses,
      queries: operation.queries,
      request: operation.request,
      shape: operation.shape
    }))
  )}
`

/** `src/corpus/viya/operations.ts` - the replayable half of the same capture. */
export const renderCorpus = (operations, version) =>
  HEADER(
    version,
    'The Viya conformance corpus: what the estate answered, as data.'
  ) +
  `
export interface ViyaCase {
  /** The operation, \`METHOD /path\`. */
  route: string
  /** The scripted pass that produced it. */
  step: string
  /** Parameter names the client sent, so a replay can build the request. */
  queries: string[]
  /** Statuses the operation may answer with. */
  statuses: number[]
  /** The status the captured answer carried. */
  expected: number
  /** The shape of the captured body, where it carried one. */
  shape?: unknown
}

export const VIYA_CORPUS: ViyaCase[] = ${literal(
    operations.map((operation) => ({
      route: operation.id,
      step: operation.steps[0],
      queries: operation.queries,
      statuses: operation.statuses,
      expected: operation.expected,
      shape: operation.shape
    }))
  )}
`

/**
 * Several captures, one surface.
 *
 * A pass is run per family - and more than once, as a family is added - so the
 * table is the union of what the runs observed. Statuses and steps accumulate
 * because they are all facts; the body sketch comes from the first row that has
 * one, because a shape that varies by run is a shape nobody captured.
 */
export const mergeOperations = (operationLists) => {
  const merged = new Map()

  for (const operations of operationLists)
    for (const operation of operations) {
      if (!merged.has(operation.id)) {
        merged.set(operation.id, {
          ...operation,
          steps: [...operation.steps],
          statuses: [...operation.statuses],
          queries: [...operation.queries]
        })
        continue
      }

      const existing = merged.get(operation.id)

      existing.steps = [
        ...new Set([...existing.steps, ...operation.steps])
      ].sort()
      existing.statuses = [
        ...new Set([...existing.statuses, ...operation.statuses])
      ].sort((a, b) => a - b)
      existing.queries = [
        ...new Set([...existing.queries, ...operation.queries])
      ].sort()

      // the status and the shape are one fact about one answer, so they are
      // chosen together: taking a success from one row and an error sketch from
      // another would document a 201 that answers `{ errorCode, message }`
      if (isBetterRow(existing, operation)) {
        existing.expected = operation.expected
        existing.shape = operation.shape
      }

      // `request` is one observed call, but its query names are unioned like
      // `queries` above: a handler built from it would otherwise omit a
      // parameter the client sent, with nothing marking it partial
      if (existing.request && operation.request)
        existing.request = {
          queries: [
            ...new Set([
              ...existing.request.queries,
              ...operation.request.queries
            ])
          ].sort(),
          body: existing.request.body ?? operation.request.body
        }
    }

  return [...merged.values()].sort((a, b) =>
    a.path === b.path
      ? a.method.localeCompare(b.method)
      : a.path.localeCompare(b.path)
  )
}
