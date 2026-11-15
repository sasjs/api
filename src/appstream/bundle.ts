/**
 * An app as one bundle: the deployment and the statement of what it publishes.
 *
 * Two shapes travel through here, and the difference is where the frontend sits.
 *
 * **A package** is what a current `sasjs build` emits for a server: a frontend, an
 * optional backend, and a manifest saying which app the frontend is.
 *
 *     sasjs.app.json      {"name": "macrodash", "appLoc": "/Public/app/macrodash"}
 *     web/                the compiled app: index.html, assets/
 *     backend/            optional: the services the app calls, written to appLoc
 *
 * The halves are named, not inferred from a path: `web/` becomes `apps/<name>` and
 * `backend/` becomes `appLoc`, and neither is guessed at from a member's name.
 * One zip therefore deploys a backend and publishes a frontend in a single
 * request, and the frontend can be republished alone by leaving `backend/` out.
 *
 * **A legacy bundle** is the shape before that: one tree deployed to `appLoc`,
 * with the web assets carried at `services/<streamWebFolder>`. It is what every
 * released CLI emits, and it keeps working unchanged - the manifest is optional
 * there because the deploy payload states the stream fields instead.
 *
 * The manifest is metadata, not an asset: it is taken out of the tree before the
 * tree is written and never appears in the app's served files.
 */
import { ApiError } from '../types.js'
import type { DeployMember, DeployTree } from '../drive/deploy.js'
import type { PublishAppRequest } from './service.js'

/** The file, at the root of an app bundle, that says the bundle is an app. */
export const APP_MANIFEST = 'sasjs.app.json'

/** The folder in a package holding the compiled frontend. */
export const FRONTEND_FOLDER = 'web'

/** The folder in a package holding the services the frontend calls. */
export const BACKEND_FOLDER = 'backend'

export interface AppManifest {
  /** The app's name: its folder under `apps/`, and its address. */
  name?: string
  /** The backend this frontend calls. Metadata, and optional. */
  appLoc?: string
  /** Legacy only: the folder under `<appLoc>/services` holding the web assets. */
  streamWebFolder?: string
  /** An asset inside the app, used as its tile image. */
  logo?: string
  /** Origins allowed to frame the app, as CSP `frame-ancestors` sources. */
  frameAncestors?: string | string[]
}

export interface AppBundle {
  /**
   * The tree the bundle's body describes - what a legacy deploy writes to
   * `appLoc`. When `frontend` is present this is the container of the two halves
   * and is NOT deployed as it stands.
   */
  tree: DeployTree
  /** The compiled frontend, when the bundle carries one at `web/`. */
  frontend?: DeployTree
  /** The backend tree, when the bundle carries services at `backend/`. */
  backend?: DeployTree
  manifest?: AppManifest
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined

  if (typeof value !== 'string' || value.trim() === '')
    throw new ApiError(
      400,
      `"${field}" must be a non-empty string in ${APP_MANIFEST}.`
    )

  return value.trim()
}

/**
 * A manifest, checked field by field, naming the field that is wrong.
 *
 * Nothing is required: a package states its name, a legacy bundle states its
 * stream folder, and a deploy that states neither in the manifest states them in
 * its payload. What the manifest states has to be usable, which is what is checked
 * here; whether the request as a whole can publish is `checkPublishRequest`'s
 * question, asked once against the request the two have been composed into.
 */
export const parseAppManifest = (value: unknown): AppManifest => {
  if (!isObject(value))
    throw new ApiError(400, `${APP_MANIFEST} must be an object.`)

  const name = text(value.name, 'name')
  const appLoc = text(value.appLoc, 'appLoc')
  const streamWebFolder = text(value.streamWebFolder, 'streamWebFolder')
  const logo = text(value.logo, 'logo')

  if (streamWebFolder !== undefined && /[\\/]/.test(streamWebFolder))
    throw new ApiError(
      400,
      `"streamWebFolder" in ${APP_MANIFEST} must be a single path segment.`
    )

  const frameAncestors = value.frameAncestors

  if (
    frameAncestors !== undefined &&
    (typeof frameAncestors !== 'string' || frameAncestors === '') &&
    !(
      Array.isArray(frameAncestors) &&
      frameAncestors.length > 0 &&
      frameAncestors.every(
        (source) => typeof source === 'string' && source !== ''
      )
    )
  )
    throw new ApiError(
      400,
      `"frameAncestors" in ${APP_MANIFEST} must be a string or a non-empty list of strings.`
    )

  return {
    ...(name === undefined ? {} : { name }),
    ...(appLoc === undefined ? {} : { appLoc }),
    ...(streamWebFolder === undefined ? {} : { streamWebFolder }),
    ...(logo === undefined ? {} : { logo }),
    ...(frameAncestors === undefined
      ? {}
      : { frameAncestors: frameAncestors as string | string[] })
  }
}

/** A member that is a folder, by name. */
const folderNamed = (
  members: DeployMember[],
  name: string
): DeployMember | undefined =>
  members.find(
    (member) =>
      isObject(member) && member.type === 'folder' && member.name === name
  )

/** A folder's own members, as a tree of its contents. */
const contentsOf = (
  member: DeployMember | undefined
): DeployTree | undefined => {
  const members = (member as { members?: unknown } | undefined)?.members

  return Array.isArray(members)
    ? { members: members as DeployMember[] }
    : undefined
}

/**
 * The deploy tree split from its manifest, and from the halves a package names.
 *
 * A tree that is not a tree is passed through untouched: the deploy is the thing
 * that refuses a malformed tree, with the message its own cases pin, and saying
 * it here as well would be two wordings of one refusal.
 *
 * A bundle is a package when it holds a `web/` folder or a manifest at its root.
 * The frontend is then that folder's contents - which is why a compiled app is
 * zipped as the folder's contents rather than the folder itself - and a `backend/`
 * folder beside it is the tree to write to `appLoc`.
 */
export const splitAppBundle = (tree: unknown): AppBundle => {
  if (!isObject(tree) || !Array.isArray(tree.members))
    return { tree: tree as unknown as DeployTree }

  const members = tree.members as DeployMember[]

  const at = members.findIndex(
    (member) =>
      isObject(member) && member.type === 'file' && member.name === APP_MANIFEST
  )

  const withoutManifest =
    at === -1 ? members : members.filter((_, index) => index !== at)

  let manifest: AppManifest | undefined

  if (at !== -1) {
    const member = members[at] as { code?: unknown }

    if (typeof member.code !== 'string')
      throw new ApiError(400, `${APP_MANIFEST} carries no text.`)

    let parsed: unknown

    try {
      parsed = JSON.parse(member.code)
    } catch (error) {
      throw new ApiError(
        400,
        `${APP_MANIFEST} is not valid JSON: ${(error as Error).message}`
      )
    }

    manifest = parseAppManifest(parsed)
  }

  const rest = { ...tree, members: withoutManifest } as DeployTree

  const web = folderNamed(withoutManifest, FRONTEND_FOLDER)

  // nothing says this is an app: pass the tree through, but without the manifest
  // only when there was one
  if (web === undefined && manifest === undefined)
    return at === -1 ? { tree: tree as unknown as DeployTree } : { tree: rest }

  // a `web/` folder is the frontend; without one, a manifest still says the tree
  // is an app, and the whole tree is then the app's own files
  const backend = contentsOf(folderNamed(withoutManifest, BACKEND_FOLDER))

  return {
    tree: rest,
    frontend: contentsOf(web) ?? {
      members: withoutManifest.filter(
        (member) => member !== folderNamed(withoutManifest, BACKEND_FOLDER)
      )
    },
    ...(backend === undefined ? {} : { backend }),
    manifest: manifest as AppManifest
  }
}

/** What a deploy request says about the app it publishes. */
export interface DeployPublish {
  /** The app's name, when the request states one. */
  name?: string
  /** The backend folder. Metadata for a frontend publish. */
  appLoc?: string
  /** Legacy: the folder under `<appLoc>/services` holding the web assets. */
  streamWebFolder?: string
  /** The app's name, under the field name an older payload uses. */
  streamServiceName?: string
  streamLogo?: string
}

/**
 * The publish a deploy asks for, or `undefined` when it publishes nothing.
 *
 * The request wins over the bundle where both speak - a caller naming a folder, a
 * name or a label is correcting the archive, not repeating it - and the bundle
 * fills what the request leaves out.
 *
 * A bundle is published as a **legacy** app when either half states a
 * `streamWebFolder`: that field is what puts the web assets inside the backend's
 * folder, and a request that keeps it is asking for the shape it describes. A
 * package publishes as a **frontend** instead, which needs only a name - the
 * folder follows from it.
 *
 * `packaged` says the bundle carries a `web/` folder, so a request that names
 * neither a stream folder nor a name is an app with nothing to call it: the
 * request comes back without a name and `checkPublishRequest` refuses it by name,
 * rather than the deploy writing the frontend nowhere.
 */
export const publishRequestFor = (
  deploy: DeployPublish,
  manifest?: AppManifest,
  options: { packaged?: boolean } = {}
): PublishAppRequest | undefined => {
  const streamWebFolder = deploy.streamWebFolder ?? manifest?.streamWebFolder
  const appLoc = deploy.appLoc ?? manifest?.appLoc
  const name = deploy.name ?? deploy.streamServiceName ?? manifest?.name
  const logo = deploy.streamLogo ?? manifest?.logo
  const frameAncestors = manifest?.frameAncestors

  if (streamWebFolder !== undefined)
    return {
      ...(appLoc === undefined ? {} : { appLoc }),
      streamWebFolder,
      ...(name === undefined ? {} : { name }),
      ...(logo === undefined ? {} : { logo }),
      ...(frameAncestors === undefined ? {} : { frameAncestors })
    }

  if (name === undefined && !options.packaged) return undefined

  return {
    ...(name === undefined ? {} : { name }),
    ...(appLoc === undefined ? {} : { appLoc }),
    ...(logo === undefined ? {} : { logo }),
    ...(frameAncestors === undefined ? {} : { frameAncestors })
  }
}
