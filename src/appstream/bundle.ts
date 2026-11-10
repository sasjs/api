/**
 * An app as one bundle: the deployment and the statement of what it publishes.
 *
 * A deploy writes a tree to a folder, and a tree of an app already holds
 * everything the app is - its services under `services/`, the compiled web assets
 * under `services/<streamWebFolder>`, and whatever jobs and data files it was
 * built with. What a tree cannot say is that the folder IS an app: which of its
 * folders holds the web build, what it should be called, and whether it may be
 * framed. That statement is a small file at the root of the archive:
 *
 *     sasjs.app.json
 *     services/
 *       web/            the compiled app: index.html, main.<hash>.js, assets/
 *       build.sas       the services the app calls
 *     jobs/
 *
 * So one zip deploys the app and the folders under it in a single request, and
 * the app is indexed as part of that deploy rather than by a second call that can
 * fail on its own. The manifest is consumed here: it is metadata, not an asset,
 * so it is stripped from the tree before the tree is written and never appears in
 * the app's served files.
 *
 * The manifest is optional. A deploy that names `streamWebFolder` in its payload
 * publishes without one, which is what an existing client does; a bundle that
 * carries a manifest needs no arguments beyond the folder it deploys to.
 */
import { ApiError } from '../types.js'
import type { DeployMember, DeployTree } from '../drive/deploy.js'
import type { PublishAppRequest } from './service.js'

/** The file, at the root of an app bundle, that says the bundle is an app. */
export const APP_MANIFEST = 'sasjs.app.json'

export interface AppManifest {
  /** The label the app is listed under. Defaults to the last segment of the folder. */
  name?: string
  /** The folder under `<appLoc>/services` holding the compiled web assets. */
  streamWebFolder: string
  /** An asset inside the app, used as its tile image. */
  logo?: string
  /** Origins allowed to frame the app, as CSP `frame-ancestors` sources. */
  frameAncestors?: string | string[]
}

export interface AppBundle {
  /** The tree to deploy: the manifest, when there is one, is not in it. */
  tree: DeployTree
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

/** A manifest, checked field by field, naming the field that is wrong. */
export const parseAppManifest = (value: unknown): AppManifest => {
  if (!isObject(value))
    throw new ApiError(400, `${APP_MANIFEST} must be an object.`)

  const streamWebFolder = text(value.streamWebFolder, 'streamWebFolder')

  if (streamWebFolder === undefined)
    throw new ApiError(
      400,
      `${APP_MANIFEST} must state "streamWebFolder": the folder under services/ holding the compiled app.`
    )

  const name = text(value.name, 'name')
  const logo = text(value.logo, 'logo')

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
    streamWebFolder,
    ...(logo === undefined ? {} : { logo }),
    ...(frameAncestors === undefined
      ? {}
      : { frameAncestors: frameAncestors as string | string[] })
  }
}

/**
 * The deploy tree split from its manifest.
 *
 * A tree that is not a tree is passed through untouched: the deploy is the thing
 * that refuses a malformed tree, with the message its own cases pin, and saying
 * it here as well would be two wordings of one refusal.
 */
export const splitAppBundle = (tree: unknown): AppBundle => {
  if (!isObject(tree) || !Array.isArray(tree.members))
    return { tree: tree as unknown as DeployTree }

  const members = tree.members as DeployMember[]

  const at = members.findIndex(
    (member) =>
      isObject(member) && member.type === 'file' && member.name === APP_MANIFEST
  )

  if (at === -1) return { tree: tree as unknown as DeployTree }

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

  return {
    tree: {
      ...tree,
      members: members.filter((_, index) => index !== at)
    } as DeployTree,
    manifest: parseAppManifest(parsed)
  }
}

/** What a deploy request says about the app it publishes. */
export interface DeployPublish {
  appLoc: string
  streamWebFolder?: string
  streamServiceName?: string
  streamLogo?: string
}

/**
 * The publish a deploy asks for, or `undefined` when it publishes nothing.
 *
 * The request wins over the bundle where both speak - a caller naming a folder or
 * a label is correcting the archive, not repeating it - and the bundle fills what
 * the request leaves out, so a deploy that carries a manifest needs neither
 * `streamWebFolder` nor `streamServiceName`.
 */
export const publishRequestFor = (
  deploy: DeployPublish,
  manifest?: AppManifest
): PublishAppRequest | undefined => {
  const streamWebFolder = deploy.streamWebFolder ?? manifest?.streamWebFolder

  if (streamWebFolder === undefined) return undefined

  const name = deploy.streamServiceName ?? manifest?.name
  const logo = deploy.streamLogo ?? manifest?.logo

  return {
    appLoc: deploy.appLoc,
    streamWebFolder,
    ...(name === undefined ? {} : { name }),
    ...(logo === undefined ? {} : { logo }),
    ...(manifest?.frameAncestors === undefined
      ? {}
      : { frameAncestors: manifest.frameAncestors })
  }
}
