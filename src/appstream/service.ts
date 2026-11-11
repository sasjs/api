/**
 * The app index: what has been published, keyed by a UUID.
 *
 * An app is one deployed folder (`appLoc`), the web assets inside it
 * (`appLoc/services/<streamWebFolder>`) and a UUID assigned when it is first
 * published. The id is the key the routes, the listing and the permission rules
 * point at; the name is a label a person reads, and carries no uniqueness rule at
 * all - two apps may be called the same thing without colliding, because nothing
 * is looked up by name.
 *
 * The service is the decisions, and a host supplies the storage. That split is
 * the point of this package: sasjs/server keeps the index in a JSON file beside
 * its drive, the browser build keeps it in the drive it already has, and both
 * answer the same listing because both call this file.
 *
 * One app per folder. Publishing a folder that is already published is the same
 * app published again: it keeps its id (so its URL survives a redeploy) and takes
 * the values the new publish states - except the label, which carries over when
 * the new publish does not name one, so a redeploy that has forgotten what the
 * app is called does not rename it to its folder. Nothing is derived from the
 * path, so a capital, a space or a `..` in a folder name is the drive's business
 * rather than an identity question.
 */
import { ApiError } from '../types.js'
import { newAppId, normaliseAppLoc } from './identity.js'

export interface AppStreamEntry {
  /** The identity: a version 4 UUID, minted once and kept for the life of the app. */
  id: string
  /** The label a person reads. Not unique, not a key, not in any URL. */
  name: string
  /** The folder the app was deployed to - the one app one folder rule. */
  appLoc: string
  /** The folder holding the web assets, relative to `appLoc/services`. */
  streamWebFolder: string
  /** An asset inside the app, served from the app's own URL. */
  logo?: string
  /** Origins allowed to frame the app, as CSP `frame-ancestors` sources. */
  frameAncestors?: string[]
  /** When this publish happened, ISO 8601. */
  publishedAt: string
}

/**
 * The published apps, as a host stores them.
 *
 * A whole-list read and write because the index is small and a host that has a
 * file, a table or a browser store should not have to implement a query language
 * to hold it. Mutations are serialised by the service, so a store only has to be
 * atomic for a single call.
 */
export interface AppStreamStore {
  read(): Promise<AppStreamEntry[]>
  write(entries: AppStreamEntry[]): Promise<void>
}

export interface PublishAppRequest {
  appLoc: string
  streamWebFolder: string
  /** The label. Defaults to the last segment of `appLoc`. */
  name?: string
  logo?: string
  frameAncestors?: string | string[]
  /** The publish time, for a caller that has a clock of its own (or a test). */
  publishedAt?: string
}

export interface AppStreamService {
  /** Every published app this caller may see, ordered by name. */
  list(allow?: (entry: AppStreamEntry) => boolean): Promise<AppStreamEntry[]>
  /** One app by id, or the `404` a client that mistyped an id expects. */
  get(id: string): Promise<AppStreamEntry>
  /** The app published at a folder, if any - the redeploy lookup. */
  forAppLoc(appLoc: string): Promise<AppStreamEntry | undefined>
  /**
   * Publishes a folder, minting an id the first time and keeping it afterwards.
   *
   * The entry IS the publish: a field the request does not state is absent from
   * the entry rather than inherited from the previous publish, so republishing
   * from a bundle that dropped its logo drops the logo. The label is the one
   * exception - it carries over unless this publish names one - because a redeploy
   * that says nothing about the name is not asking for a rename.
   */
  publish(request: PublishAppRequest): Promise<AppStreamEntry>
  /** Removes the app the id names, and returns what was removed. */
  unpublish(id: string): Promise<AppStreamEntry>
}

/** What a publish answers: enough for a client to print the app's URL. */
export const appSummary = (
  entry: AppStreamEntry
): { id: string; name: string; url: string } => ({
  id: entry.id,
  name: entry.name,
  url: `/app/${entry.id}/`
})

/** A folder holding web assets: one segment, so it cannot climb out of the app. */
const webFolderOf = (value: unknown): string => {
  if (typeof value !== 'string' || value === '')
    throw new ApiError(400, '"streamWebFolder" is required')

  if (value === '.' || value === '..' || /[\\/]/.test(value))
    throw new ApiError(400, 'streamWebFolder must be a single path segment.')

  return value
}

/** The label an app gets when the publish does not name one. */
export const defaultAppName = (appLoc: string): string => {
  const segment = appLoc.split('/').filter(Boolean).pop()

  return segment ? segment : 'app'
}

/**
 * Whether two spellings name one folder.
 *
 * A location that cannot be a folder matches nothing rather than throwing: an
 * index written by hand, or by an older shape, holds one bad entry at most, and
 * that entry must not stop every publish and every redeploy lookup on the host.
 */
const sameAppLoc = (left: string, right: string): boolean => {
  try {
    return normaliseAppLoc(left) === normaliseAppLoc(right)
  } catch (_) {
    return false
  }
}

/** The same folder spellings `normaliseAppLoc` collapses, as a `400` rather than a throw. */
const appLocOf = (value: string): string => {
  try {
    return normaliseAppLoc(value)
  } catch (error) {
    throw new ApiError(400, (error as Error).message)
  }
}

/** A publish request with every field in the shape the index stores. */
export interface CheckedPublish extends Omit<
  PublishAppRequest,
  'frameAncestors'
> {
  frameAncestors?: string[]
}

/**
 * Whether a deploy tree carries the folder an app is served from.
 *
 * An app is served out of `<appLoc>/services/<streamWebFolder>`, so a tree
 * without that folder would be indexed and then answer `404` to every request -
 * a tile that opens nothing, which is worse than a refusal that names the missing
 * folder. Both the check below and a host that wants to decide earlier read this.
 */
export const hasStreamFolder = (
  tree: unknown,
  streamWebFolder: string
): boolean => {
  const members = (tree as { members?: unknown })?.members

  if (!Array.isArray(members)) return false

  const isFolder = (member: unknown, name: string): boolean => {
    const entry = member as {
      name?: unknown
      type?: unknown
      members?: unknown
    }

    return entry?.type === 'folder' && entry?.name === name
  }

  const services = members.find((member) => isFolder(member, 'services'))
  const children = (services as { members?: unknown })?.members

  return (
    Array.isArray(children) &&
    children.some((member) => isFolder(member, streamWebFolder))
  )
}

/**
 * A publish request, checked and normalised, with no default applied.
 *
 * Separate from `publish` so a host can refuse a publish BEFORE it writes the
 * deployment: the drive and the index are two writes, and a request the index
 * would refuse must not leave the files behind. `name` is left absent when the
 * caller did not state one, because a redeploy inherits the label it had.
 *
 * The tree is optional so that a caller holding only the request can still check
 * it; when it is stated, the folder the app would be served from has to be in it.
 */
export const checkPublishRequest = (
  request: PublishAppRequest,
  tree?: unknown
): CheckedPublish => {
  const appLoc = appLocOf(request.appLoc)

  // the drive root is not a folder an app can live in: a deploy to `/` writes
  // `//index.html`, which nothing can read, so it is refused rather than indexed
  if (appLoc === '/')
    throw new ApiError(400, 'An app cannot be published at the drive root.')

  const logo = logoOf(request.logo)
  const frameAncestors = frameAncestorsOf(request.frameAncestors)
  const streamWebFolder = webFolderOf(request.streamWebFolder)

  // the tree has to carry the folder the app is served from, or the publish
  // advertises an app whose every request is a `404`
  if (tree !== undefined && !hasStreamFolder(tree, streamWebFolder))
    throw new ApiError(
      400,
      `The deployed tree has no "services/${streamWebFolder}" folder, so nothing would be published at ${appLoc}. Deploy the web assets under services/${streamWebFolder}, or omit streamWebFolder.`
    )

  return {
    appLoc,
    streamWebFolder,
    ...(request.name === undefined
      ? {}
      : { name: nameOf(request.name, appLoc) }),
    ...(logo === undefined ? {} : { logo }),
    ...(frameAncestors === undefined ? {} : { frameAncestors }),
    ...(request.publishedAt === undefined
      ? {}
      : { publishedAt: request.publishedAt })
  }
}

const nameOf = (value: unknown, appLoc: string): string => {
  if (value === undefined) return defaultAppName(appLoc)

  if (typeof value !== 'string' || value.trim() === '')
    throw new ApiError(400, '"name" must be a non-empty string')

  return value.trim()
}

const logoOf = (value: unknown): string | undefined => {
  if (value === undefined) return undefined

  if (typeof value !== 'string' || value === '')
    throw new ApiError(400, '"logo" must be a non-empty string')

  return value
}

const frameAncestorsOf = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined

  const list = Array.isArray(value) ? value : [value]

  if (
    list.length === 0 ||
    list.some((source) => typeof source !== 'string' || source === '')
  )
    throw new ApiError(
      400,
      '"frameAncestors" must be a string or a non-empty list of strings'
    )

  return [...(list as string[])]
}

/**
 * The index, over a store.
 *
 * Every mutation reads the whole list, changes it and writes it back, so two
 * publishes that overlap would discard each other's entry - the loser's change
 * vanishing silently, which is the worst way for an index to be wrong. One queue
 * removes the interleaving without a lock.
 */
export const createAppStreamService = (
  store: AppStreamStore
): AppStreamService => {
  let queue: Promise<unknown> = Promise.resolve()

  const mutate = <T>(work: () => Promise<T>): Promise<T> => {
    // `then(work, work)`: a failed mutation must not poison the queue
    const run = queue.then(work, work)

    queue = run.catch(() => undefined)

    return run
  }

  const readable = (
    allow?: (entry: AppStreamEntry) => boolean
  ): Promise<AppStreamEntry[]> =>
    store.read().then((entries) =>
      entries
        .filter((entry) => (allow ? allow(entry) : true))
        .map((entry) => ({ ...entry }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    )

  return {
    list: readable,

    async get(id) {
      const entry = (await store.read()).find(
        (candidate) => candidate.id === id
      )

      if (!entry) throw new ApiError(404, 'No app is published with that id.')

      return { ...entry }
    },

    async forAppLoc(appLoc) {
      // spelled inconsistently by a caller is still one folder; a location that
      // cannot name a folder simply has no app
      let normalised: string

      try {
        normalised = normaliseAppLoc(appLoc)
      } catch (_) {
        return undefined
      }

      const entry = (await store.read()).find((candidate) =>
        sameAppLoc(candidate.appLoc, normalised)
      )

      return entry ? { ...entry } : undefined
    },

    publish(request) {
      return mutate(async () => {
        const checked = checkPublishRequest(request)
        const appLoc = checked.appLoc
        const streamWebFolder = checked.streamWebFolder
        const entries = await store.read()

        // the folder is the app, so a redeploy is the same app published again:
        // it keeps the id its URL depends on, and takes the values this publish
        // states rather than the ones the previous publish left behind
        const existing = entries.find((entry) =>
          sameAppLoc(entry.appLoc, appLoc)
        )

        const logo = checked.logo
        const frameAncestors = checked.frameAncestors

        const entry: AppStreamEntry = {
          id: existing ? existing.id : newAppId(),
          // the label is the one field a redeploy inherits: everything else is
          // what this publish states
          name: nameOf(checked.name ?? existing?.name, appLoc),
          appLoc,
          streamWebFolder,
          ...(logo === undefined ? {} : { logo }),
          ...(frameAncestors === undefined ? {} : { frameAncestors }),
          publishedAt: checked.publishedAt ?? new Date().toISOString()
        }

        await store.write([
          ...entries.filter(
            (candidate) => !sameAppLoc(candidate.appLoc, appLoc)
          ),
          entry
        ])

        return { ...entry }
      })
    },

    unpublish(id) {
      return mutate(async () => {
        const entries = await store.read()

        const index = entries.findIndex((entry) => entry.id === id)

        // the id is the app, and the only handle: a label is shared by design and
        // a folder is where the app was published rather than what it is
        if (index === -1)
          throw new ApiError(404, 'No app is published with that id.')

        const [removed] = entries.splice(index, 1)

        await store.write(entries)

        return { ...removed }
      })
    }
  }
}

/** An index with no storage behind it: what a browser host and the corpus start from. */
export class MemoryAppStreamStore implements AppStreamStore {
  private entries: AppStreamEntry[]

  constructor(entries: AppStreamEntry[] = []) {
    this.entries = entries.map((entry) => ({ ...entry }))
  }

  async read(): Promise<AppStreamEntry[]> {
    return this.entries.map((entry) => ({ ...entry }))
  }

  async write(entries: AppStreamEntry[]): Promise<void> {
    this.entries = entries.map((entry) => ({ ...entry }))
  }
}
