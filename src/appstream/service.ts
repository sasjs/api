/**
 * The app index: what has been published, keyed by a UUID.
 *
 * An app is a **frontend**: a named folder under `apps/` in the drive, and a UUID
 * assigned when it is first published. The id is the key the routes, the listing
 * and the permission rules point at, and it is what a redeploy keeps. The name is
 * the app's address as well as its label - `/app/<name>` opens it and
 * `apps/<name>` holds it - so a name is validated as a URL segment and has to be
 * free.
 *
 * A backend is metadata. An app may name the `appLoc` whose services its frontend
 * calls, and several apps may name the same one: a frontend is what an app is,
 * and where its services live is a fact about the app rather than its identity.
 * The backend's files are provisioned by a publish that carries them, which is a
 * separate, optional half of a bundle.
 *
 * One legacy shape survives, and only so that a deployment made by an older CLI
 * keeps serving: an entry carrying `streamWebFolder` keeps its web assets where
 * that shape put them, `<appLoc>/services/<streamWebFolder>`, and is still keyed
 * by its folder. Republishing it from a current bundle moves it to `apps/<name>`.
 *
 * The service is the decisions, and a host supplies the storage. That split is
 * the point of this package: sasjs/server keeps the index in a JSON file beside
 * its drive, the browser build keeps it in the drive it already has, and both
 * answer the same listing because both call this file.
 *
 * Publishing an app that is already published is the same app published again: it
 * keeps its id (so its URL survives a redeploy) and takes the values the new
 * publish states - except the label, which carries over when the new publish does
 * not name one, so a redeploy that has forgotten what the app is called does not
 * rename it.
 */
import { ApiError } from '../types.js'
import { newAppId, normaliseAppLoc } from './identity.js'

/**
 * Where a frontend lives in the drive: one reserved folder, so an app's files are
 * found by its name alone and nothing has to be recorded about the location.
 */
export const APP_FOLDERS_ROOT = 'apps'

/** The drive folder holding an app's frontend. */
export const frontendFolderOf = (name: string): string =>
  `/${APP_FOLDERS_ROOT}/${name}`

export interface AppStreamEntry {
  /** The identity: a version 4 UUID, minted once and kept for the life of the app. */
  id: string
  /** The key: the app's name, its folder under `apps/`, and its address. */
  name: string
  /**
   * The backend this frontend calls, when it has one. Metadata: several apps may
   * name the same folder, and a frontend-only app names none.
   */
  appLoc?: string
  /**
   * The legacy shape, and only the legacy shape: the web assets live at
   * `<appLoc>/services/<streamWebFolder>`. An entry without it is served from
   * `apps/<name>`.
   */
  streamWebFolder?: string
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
  /**
   * The app's name: the key, the folder under `apps/` and the address. Required
   * of a frontend publish, optional for a legacy one (which derives it from the
   * folder).
   */
  name?: string
  /** The backend this frontend calls. Optional: a frontend-only app names none. */
  appLoc?: string
  /**
   * The legacy publish only: the folder under `<appLoc>/services` holding the web
   * assets. Stating it keeps the entry in the legacy shape.
   */
  streamWebFolder?: string
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
 * folder.
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
 * Whether a deploy tree is a frontend: something to open.
 *
 * A frontend is served from its folder root, so the root has to hold the page a
 * browser opens. Without it the publish would advertise an app that answers `404`
 * to every request - a tile that opens nothing, which is worse than a refusal that
 * names what is missing.
 */
export const hasFrontendRoot = (tree: unknown): boolean => {
  const members = (tree as { members?: unknown })?.members

  if (!Array.isArray(members)) return false

  return members.some((member) => {
    const entry = member as { name?: unknown; type?: unknown }

    return entry?.type === 'file' && entry?.name === 'index.html'
  })
}

/**
 * A publish request, checked and normalised, with no default applied.
 *
 * Separate from `publish` so a host can refuse a publish BEFORE it writes the
 * deployment: the drive and the index are two writes, and a request the index
 * would refuse must not leave the files behind. `name` is left absent when the
 * caller did not state one, because a legacy redeploy inherits the label it had.
 *
 * Two shapes, told apart by `streamWebFolder`:
 *
 * - **legacy** - `streamWebFolder` and `appLoc` stated: the web assets are at
 *   `<appLoc>/services/<streamWebFolder>`, which is where the tree has to carry
 *   them. This is what an older CLI deploys, and it stays exactly as it was.
 * - **frontend** - no `streamWebFolder`: the app is `apps/<name>`, so the name is
 *   required and is validated as the folder it now is. `appLoc` is optional
 *   metadata naming the backend.
 *
 * The tree is optional so a caller holding only the request can still check it.
 */
export const checkPublishRequest = (
  request: PublishAppRequest,
  tree?: unknown,
  options: { folderFromManifest?: boolean } = {}
): CheckedPublish => {
  const logo = logoOf(request.logo)
  const frameAncestors = frameAncestorsOf(request.frameAncestors)
  const timing =
    request.publishedAt === undefined
      ? {}
      : { publishedAt: request.publishedAt }

  if (request.streamWebFolder !== undefined) {
    if (request.appLoc === undefined)
      throw new ApiError(
        400,
        '"appLoc" is required when "streamWebFolder" is stated: the entry keeps its web assets at <appLoc>/services/<streamWebFolder>, so both halves are needed to say where they are.'
      )

    const appLoc = appLocOf(request.appLoc)

    // the drive root is not a folder an app can live in: a deploy to `/` writes
    // `//index.html`, which nothing can read, so it is refused rather than indexed
    if (appLoc === '/')
      throw new ApiError(400, 'An app cannot be published at the drive root.')

    const streamWebFolder = webFolderOf(request.streamWebFolder)

    // the tree has to carry the folder the app is served from, or the publish
    // advertises an app whose every request is a `404`. The advice names the source
    // of the folder: a caller whose bundle stated it cannot omit the field, and the
    // bundle is the thing to correct.
    if (tree !== undefined && !hasStreamFolder(tree, streamWebFolder))
      throw new ApiError(
        400,
        `The deployed tree has no "services/${streamWebFolder}" folder, so nothing would be published at ${appLoc}. Deploy the web assets under services/${streamWebFolder}, or ${
          options.folderFromManifest
            ? 'correct the folder sasjs.app.json names.'
            : 'omit streamWebFolder.'
        }`
      )

    return {
      appLoc,
      streamWebFolder,
      ...(request.name === undefined ? {} : { name: nameOf(request.name) }),
      ...(logo === undefined ? {} : { logo }),
      ...(frameAncestors === undefined ? {} : { frameAncestors }),
      ...timing
    }
  }

  // a frontend publish: the name is the folder, so there is no sensible default
  if (request.name === undefined)
    throw new ApiError(
      400,
      '"name" is required: an app is published at apps/<name>, so the publish has to say what it is called.'
    )

  const name = nameOf(request.name)
  const appLoc =
    request.appLoc === undefined ? undefined : appLocOf(request.appLoc)

  if (appLoc === '/')
    throw new ApiError(400, 'An app cannot name the drive root as its backend.')

  if (tree !== undefined && !hasFrontendRoot(tree))
    throw new ApiError(
      400,
      `The deployed tree has no "index.html" at its root, so nothing would be published at apps/${name}. Publish the compiled web folder itself, not the folder that holds it.`
    )

  return {
    name,
    ...(appLoc === undefined ? {} : { appLoc }),
    ...(logo === undefined ? {} : { logo }),
    ...(frameAncestors === undefined ? {} : { frameAncestors }),
    ...timing
  }
}

const nameOf = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim() === '')
    throw new ApiError(400, '"name" must be a non-empty string')

  return urlSafeName(value.trim())
}

/**
 * A stated name is a URL segment, so it has to be spellable in one.
 *
 * `/app/<name>` resolves an app by its name when exactly one holds it, which
 * makes the name an address and not only a label. A name carrying a space, a
 * `#`, a `?` or a `/` is either unopenable or forced through percent-encoding -
 * `/app/Macro%20Dash/` - and a name that collides with the surface's own paths
 * (`apps.json`, the landing page's `index.html`) can never be opened by name at
 * all, because those are answered before any app is looked up.
 *
 * Only a STATED name is held to this. A label derived from the folder stays as
 * the folder spelled it, because a deployment that never chose a name did not
 * choose an address either, and two folders sharing a leaf name are a fact of
 * the drive rather than a naming decision.
 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/
const NAME_MAX_LENGTH = 64
const RESERVED_NAMES = ['apps.json', 'index.html']

const urlSafeName = (name: string): string => {
  if (name.length > NAME_MAX_LENGTH)
    throw new ApiError(
      400,
      `"name" must be at most ${NAME_MAX_LENGTH} characters, and "${name}" is ${name.length}.`
    )

  if (!NAME_PATTERN.test(name))
    throw new ApiError(
      400,
      `"name" must be usable as a URL segment - letters, digits, dot, dash, underscore or tilde, starting with a letter or digit - so "/app/${name}" can be opened. "${name}" is not, because it carries a character that has to be percent-encoded, or a space.`
    )

  if (RESERVED_NAMES.includes(name.toLowerCase()))
    throw new ApiError(
      400,
      `"name" cannot be "${name}": the App Stream answers /app/${name} itself, so an app with that name could never be opened by name.`
    )

  return name
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

      // legacy entries only: a frontend app names a backend it CALLS, which is not
      // a claim to have been published there
      const entry = (await store.read()).find(
        (candidate) =>
          candidate.streamWebFolder !== undefined &&
          candidate.appLoc !== undefined &&
          sameAppLoc(candidate.appLoc, normalised)
      )

      return entry ? { ...entry } : undefined
    },

    publish(request) {
      return mutate(async () => {
        const checked = checkPublishRequest(request)
        const entries = await store.read()
        const legacy = checked.streamWebFolder !== undefined

        // A legacy publish is keyed by the folder it deployed to; a frontend
        // publish by its name, which IS its folder. Either way a redeploy finds the
        // entry it published before and keeps its id, which is what its URL
        // depends on. The name is compared exactly: a drive that ignores case would
        // hold one folder for two spellings, so a case-only difference is a clash
        // rather than a redeploy.
        const sameTarget = (candidate: AppStreamEntry): boolean =>
          legacy
            ? candidate.streamWebFolder !== undefined &&
              candidate.appLoc !== undefined &&
              sameAppLoc(candidate.appLoc, checked.appLoc as string)
            : candidate.streamWebFolder === undefined &&
              candidate.name === checked.name

        const existing = entries.find(sameTarget)

        const logo = checked.logo
        const frameAncestors = checked.frameAncestors

        // A legacy label is a label: it was not chosen here, it may predate this
        // rule, and two folders may share a leaf name. A frontend name is the
        // folder and the address, so it has to be free.
        const name = legacy
          ? (checked.name ??
            existing?.name ??
            defaultAppName(checked.appLoc as string))
          : (checked.name as string)

        // A legacy label is only validated when this publish STATES one; a name it
        // inherits, or one derived from the folder, predates the rule. A frontend
        // name is the folder and the address, so it is always the caller's.
        if (!legacy || checked.name !== undefined) {
          const clash = entries.find(
            (candidate) =>
              candidate !== existing &&
              candidate.name.toLowerCase() === name.toLowerCase()
          )

          if (clash)
            throw new ApiError(
              409,
              `The name "${name}" is already the address of the app at ${
                clash.appLoc ?? frontendFolderOf(clash.name)
              }. An app's name is how it opens (/app/${name}), and two apps holding one name would answer an ambiguous lookup with nothing, so publish this one under a different name.`
            )
        }

        const entry: AppStreamEntry = {
          id: existing ? existing.id : newAppId(),
          // the label is the one field a redeploy inherits: everything else is
          // what this publish states
          name,
          ...(checked.appLoc === undefined ? {} : { appLoc: checked.appLoc }),
          ...(checked.streamWebFolder === undefined
            ? {}
            : { streamWebFolder: checked.streamWebFolder }),
          ...(logo === undefined ? {} : { logo }),
          ...(frameAncestors === undefined ? {} : { frameAncestors }),
          publishedAt: checked.publishedAt ?? new Date().toISOString()
        }

        await store.write([
          ...entries.filter((candidate) => !sameTarget(candidate)),
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
