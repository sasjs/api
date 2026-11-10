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
 * the values the new publish states. Nothing is derived from the path, so a
 * capital, a space or a `..` in a folder name is the drive's business rather than
 * an identity question.
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

/** How an app is named for removal: by id, or - in a deploy's own words - by folder. */
export interface AppReference {
  id?: string
  appLoc?: string
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
   * from a bundle that dropped its logo drops the logo.
   */
  publish(request: PublishAppRequest): Promise<AppStreamEntry>
  /** Removes an app from the index, and returns what was removed. */
  unpublish(reference: AppReference): Promise<AppStreamEntry>
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

/** The same folder spellings `normaliseAppLoc` collapses, as a `400` rather than a throw. */
const appLocOf = (value: string): string => {
  try {
    return normaliseAppLoc(value)
  } catch (error) {
    throw new ApiError(400, (error as Error).message)
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

      const entry = (await store.read()).find(
        (candidate) => normaliseAppLoc(candidate.appLoc) === normalised
      )

      return entry ? { ...entry } : undefined
    },

    publish(request) {
      return mutate(async () => {
        const appLoc = appLocOf(request.appLoc)
        const streamWebFolder = webFolderOf(request.streamWebFolder)
        const entries = await store.read()

        // the folder is the app, so a redeploy is the same app published again:
        // it keeps the id its URL depends on, and takes the values this publish
        // states rather than the ones the previous publish left behind
        const existing = entries.find(
          (entry) => normaliseAppLoc(entry.appLoc) === appLoc
        )

        const logo = logoOf(request.logo)
        const frameAncestors = frameAncestorsOf(request.frameAncestors)

        const entry: AppStreamEntry = {
          id: existing ? existing.id : newAppId(),
          name: nameOf(request.name ?? existing?.name, appLoc),
          appLoc,
          streamWebFolder,
          ...(logo === undefined ? {} : { logo }),
          ...(frameAncestors === undefined ? {} : { frameAncestors }),
          publishedAt: request.publishedAt ?? new Date().toISOString()
        }

        await store.write([
          ...entries.filter(
            (candidate) => normaliseAppLoc(candidate.appLoc) !== appLoc
          ),
          entry
        ])

        return { ...entry }
      })
    },

    unpublish(reference) {
      return mutate(async () => {
        const entries = await store.read()

        const match = (entry: AppStreamEntry): boolean => {
          if (reference.id !== undefined) return entry.id === reference.id

          if (reference.appLoc === undefined) return false

          try {
            return (
              normaliseAppLoc(entry.appLoc) ===
              normaliseAppLoc(reference.appLoc)
            )
          } catch (_) {
            return false
          }
        }

        if (reference.id === undefined && reference.appLoc === undefined)
          throw new ApiError(
            400,
            'An app is named for removal by "id" or by "appLoc", and neither was given.'
          )

        const index = entries.findIndex(match)

        if (index === -1)
          throw new ApiError(
            404,
            reference.id !== undefined
              ? 'No app is published with that id.'
              : 'No app is published at that folder.'
          )

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
