/**
 * The vocabulary the two hosts share.
 *
 * Nothing here imports a runtime: the package is consumed by an Express server
 * in node and by a service worker in a browser, so the types are all this file
 * may contain. That is also why the build compiles `src` with `types: []` - an
 * accidental `Buffer` or `process` reference fails the build rather than the
 * worker at run time.
 */

/**
 * A refusal the API answers with: the status a client keys on, and the message
 * it prints. Both hosts throw this and both render it the same way, so the
 * corpus can assert on the pair.
 */
export class ApiError extends Error {
  /** Told apart by marker rather than `instanceof` - see `isApiError`. */
  readonly apiError = true

  constructor(
    readonly status: number,
    message: string,
    /**
     * The body the route renders instead of the bare message.
     *
     * Most drive routes send the message as text (`res.status(code).send(err)`),
     * and that stays the default: a body here is for the routes that answer an
     * envelope, which today is the two deploy routes and their
     * `{status: 'failure', message}`.
     */
    readonly body?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * `instanceof` survives here (the package targets ES2020, not ES5), but a
 * consumer that downlevels it - the CLI does - loses the prototype chain, so the
 * marker is what the checks use. Asserting both in a spec is what keeps that
 * honest.
 */
export const isApiError = (value: unknown): value is ApiError =>
  !!value && (value as ApiError).apiError === true

/**
 * What a route needs from a host in order to answer it.
 *
 * `runtime` is a program runtime - the host decides which languages it holds
 * (the browser build runs JavaScript, a server runs JavaScript and SAS) and
 * answers 501 when the program it was given is in a language it has no runtime
 * for. `sas` is a SAS engine specifically, for a route that cannot be answered
 * without one.
 */
export type Capability =
  | 'runtime' // a program runtime to execute the request's program in
  | 'storage' // a writable drive
  | 'identity' // users, groups and permission rules
  | 'sas' // a SAS engine
  | 'node' // node-only facilities (multer, streams, the filesystem)

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'

export type ParamLocation = 'query' | 'path' | 'body' | 'formData' | 'header'

export interface RouteParam {
  name: string
  in: ParamLocation
  required: boolean
  /** JSON-schema type as the OpenAPI document words it. */
  type: string
  enum?: string[]
}

export interface RouteResponse {
  status: number
  description: string
  /** The body the server actually sends, where the corpus pins one. */
  body?: unknown
}

/** An operation exactly as the OpenAPI document states it. */
export interface GeneratedRoute {
  id: string
  method: HttpMethod
  path: string
  tag: string
  summary: string
  params: RouteParam[]
  requestBodies: string[]
  responses: Array<{ status: number; description: string }>
}

export interface Route extends GeneratedRoute {
  responses: RouteResponse[]
  /**
   * Statuses the document states that only a HOST can send - a login lockout is
   * the host's limiter, a provider failure is its identity provider. The corpus
   * does not answer them, so the parity check compares the document without
   * them; the host's own suite pins them.
   *
   * Optional, and read as empty when absent: a host that builds a `Route` of its
   * own is describing the document, not the lockout, and requiring the field
   * made every such value a compile error.
   */
  hostResponses?: number[]
  capabilities: Capability[]
  /**
   * Whether this package carries a handler for the operation. A host may still
   * refuse it for a missing capability - that is a 501 naming the capability,
   * not an absence nobody can see.
   */
  implemented: boolean
  /**
   * Why this package does not implement the operation, and what it waits on.
   * Present exactly when `implemented` is false: the overlay's entries are a
   * decision either way, and `src/routes/index.ts` refuses to build a table with
   * an operation nobody has decided about. A 501 carries it to the caller.
   */
  reason?: string
}

/**
 * The drive, as the services see it.
 *
 * Every path is drive-relative and already normalised by `normaliseDrivePath`:
 * it starts with `/`, never contains `.` or `..`, and cannot leave the drive.
 * The store owns the translation to wherever the bytes actually live - a folder
 * under node, a Map in the browser - and owns the representation it uses to do
 * it (text vs bytes).
 */
export interface DriveStore {
  read(path: string): Promise<string | Uint8Array>
  write(path: string, contents: string | Uint8Array): Promise<void>
  exists(path: string): Promise<boolean>
  /**
   * What is at a path, as a host can report it.
   *
   * `modified` and `created` are ISO timestamps and optional: a store with no
   * clock behind it (a Map seeded from a fixture) omits them rather than
   * inventing a date. A host that has them - a filesystem, a browser's file
   * metadata - states them, and they travel to the client on the drive tree.
   */
  stat(path: string): Promise<{
    directory: boolean
    size: number
    modified?: string
    created?: string
  }>
  list(path: string): Promise<{ files: string[]; folders: string[] }>
  mkdirp(path: string): Promise<void>
  /** Removes a file, or a folder with everything under it. */
  remove(path: string): Promise<void>
  move(from: string, to: string): Promise<void>
}

export interface TreeNode {
  name: string
  relativePath: string
  isFolder: boolean
  /** ISO timestamp of the last write, when the host can report one. */
  modified?: string
  /** ISO timestamp of creation, when the host can report one. */
  created?: string
  children: TreeNode[]
}
