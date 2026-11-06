/**
 * Deploying a file tree, and the cap that bounds it.
 *
 * `POST /SASjsApi/drive/deploy` writes a whole tree in one request, which makes
 * it the one drive operation where a caller can fill the host's storage: the
 * others write a single file at a time, bounded by the host's upload limit. So
 * the tree is measured and its names checked BEFORE anything is written, and a
 * refusal leaves the drive exactly as it was.
 *
 * The numbers live here rather than in a host, because both hosts answer the
 * same `413` and a corpus case pins the wording: a limit stated twice is a limit
 * that disagrees with itself in the release nobody re-read.
 *
 * Nothing here imports a runtime. A base64 file member is decoded by hand and a
 * service's size is counted as UTF-8 by hand, because the same build runs in a
 * service worker where `Buffer` does not exist and the package compiles against
 * `lib: ES2020` with no ambient types.
 */
import type { DriveStore } from '../types.js'
import { ApiError } from '../types.js'
import { normaliseDrivePath } from './paths.js'

/** The three member kinds the wire format carries. */
export type DeployMemberType = 'folder' | 'service' | 'file'

export interface DeployFolderMember {
  name: string
  type: 'folder'
  members: DeployMember[]
}

/** A program; written as `<name>.sas`, its `code` being the program text. */
export interface DeployServiceMember {
  name: string
  type: 'service'
  code: string
}

/** A file; `code` is base64 of the bytes to write. */
export interface DeployFileMember {
  name: string
  type: 'file'
  code: string
}

export type DeployMember =
  DeployFolderMember | DeployServiceMember | DeployFileMember

export interface DeployTree {
  members: DeployMember[]
}

/**
 * The deploy cap, in binary megabytes (the unit a host's upload limit reports)
 * and compared inclusively: a tree of exactly 10,000 entries and exactly 100 MB
 * passes.
 *
 * The three dimensions fail differently and so are separate: an estate is many
 * small files (`entries`), a compiled service is one large file (`fileBytes`),
 * and the total is what the host holds in memory before the tree reaches the
 * drive (`totalBytes`).
 */
export interface DeployLimits {
  readonly entries: number
  readonly totalBytes: number
  readonly fileBytes: number
}

export const DEPLOY_LIMITS: DeployLimits = {
  entries: 10000,
  totalBytes: 100 * 1024 * 1024,
  fileBytes: 20 * 1024 * 1024
}

/**
 * The largest a deploy tree can be on the wire, which is what a host's transport
 * has to admit.
 *
 * The cap is stated in DECODED bytes; the tree travels as JSON in which a file
 * member's contents are base64 - 4/3 of what they write - and a service's are
 * escaped text (~1.04). A tree at `totalBytes` therefore reaches the parser at
 * up to ~134MB, and a transport that admits less refuses first with its own
 * shape, so the cap it was meant to enforce is never consulted. 140MB leaves
 * room for the tree's JSON scaffolding.
 *
 * Only the deploy routes use it: everywhere else a smaller limit applies,
 * because a body is buffered before authentication and nothing else needs the
 * headroom.
 */
export const DEPLOY_PAYLOAD_BYTES = 140 * 1024 * 1024

/**
 * The body a deploy answers success with.
 *
 * The wording is the published contract - a client may key on the message - so
 * it is one constant here rather than a string in each host. It names
 * `@sasjs/server` because that is the document's example, which predates this
 * package; changing it is a document change, not a host's choice.
 */
export const DEPLOY_SUCCESS = {
  status: 'success',
  message: 'Files deployed successfully to @sasjs/server.'
} as const

/** The refusal a deploy earns, in the shape the deploy routes render. */
export interface DeployRefusal {
  code: 400 | 413
  status: 'failure'
  message: string
}

export interface DeployMeasurements {
  entries: number
  totalBytes: number
  /** The largest single member, by decoded size, with its path in the tree. */
  largest: { path: string; bytes: number }
}

/** What a walk accumulates: the measurements, and the first thing refused. */
interface DeployWalk extends DeployMeasurements {
  nameRefusal?: DeployRefusal
  /** The depth the tree reached when it went past `MAX_DEPTH`, if it did. */
  tooDeep?: number
}

/**
 * How deep a tree may nest.
 *
 * A deployment is an app: `services/`, `web/`, a folder per service. A few dozen
 * levels is generous, and the number matters because the walk recurses once per
 * level - without a ceiling, a tree nested deeply enough exhausts the stack and
 * throws a `RangeError`, which is neither the `400` nor the `413` this route
 * documents, on input the cap exists to bound.
 */
export const MAX_DEPTH = 32

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** A base64 body without its padding, which is what the arithmetic needs. */
const base64Body = (value: string) => value.replace(/[^A-Za-z0-9+/]/g, '')

/** The bytes a base64 body decodes to, without decoding it. */
const base64Length = (value: string) =>
  Math.floor((base64Body(value).length * 3) / 4)

/** The bytes a base64 body decodes to, for a store that writes bytes. */
export const decodeBase64 = (value: string): Uint8Array => {
  const body = base64Body(value)
  const bytes = new Uint8Array(Math.floor((body.length * 3) / 4))

  let buffer = 0
  let bits = 0
  let at = 0

  for (const char of body) {
    buffer = (buffer << 6) | BASE64_ALPHABET.indexOf(char)
    bits += 6

    if (bits >= 8) {
      bits -= 8
      bytes[at++] = (buffer >> bits) & 0xff
    }
  }

  return bytes.subarray(0, at)
}

/** The bytes a string occupies as UTF-8, without an encoding API. */
const utf8Length = (value: string): number => {
  let bytes = 0

  for (let at = 0; at < value.length; at++) {
    const code = value.charCodeAt(at)

    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && at + 1 < value.length) {
      // a surrogate pair is one code point of four bytes
      bytes += 4
      at++
    } else bytes += 3
  }

  return bytes
}

/** The name a member is written under - a service gains the extension. */
const memberName = (member: DeployMember): string =>
  member.type === 'service' ? `${member.name}.sas` : member.name

/** The bytes a member writes. */
const memberBytes = (member: DeployServiceMember | DeployFileMember): number =>
  member.type === 'file' ? base64Length(member.code) : utf8Length(member.code)

const MEGABYTE = 1024 * 1024

/**
 * A MEASURED size, rounded UP to one decimal in binary megabytes.
 *
 * Up, not to nearest: a tree one byte over a 100 MB cap must not read as "100 MB
 * (maximum 100 MB)", which is a refusal that states no overage at all. Rounding
 * up is the direction that never understates what is being refused.
 *
 * Bytes below a megabyte are printed as bytes, because a limit small enough to
 * be measured in bytes should not read as "0 MB" - which is what a host passing
 * a tighter set would otherwise report.
 */
const describeSize = (bytes: number) =>
  bytes < MEGABYTE
    ? `${bytes} bytes`
    : `${Math.ceil((bytes / MEGABYTE) * 10) / 10} MB`

/**
 * A LIMIT, printed as it is stated: `DEPLOY_LIMITS` holds exact megabytes, so
 * rounding cannot make it disagree with itself.
 */
const describeLimit = (bytes: number) =>
  bytes < MEGABYTE
    ? `${bytes} bytes`
    : `${Math.round((bytes / MEGABYTE) * 10) / 10} MB`

/** A walk's starting point. */
const emptyWalk = (): DeployWalk => ({
  entries: 0,
  totalBytes: 0,
  largest: { path: '', bytes: 0 }
})

/**
 * Every member name becomes a path SEGMENT under the deployment root, so a name
 * carrying '/', '\' or '..' is a traversal attempt rather than a name.
 */
const isSafeSegment = (name: string): boolean =>
  name !== '' &&
  name !== '.' &&
  name !== '..' &&
  !/[/\\]/.test(name) &&
  // a Windows drive or a NUL byte is never a segment either
  !/[\0]/.test(name)

/**
 * Walks a tree, counting it and noting the first unsafe name.
 *
 * A name problem is RECORDED rather than returned, so the walk always finishes:
 * a caller that only wants the numbers gets the size of the whole tree, and the
 * validator decides whether the name matters. Returning early would report a
 * truncated tree as if it were the real one.
 *
 * The one thing that stops the walk is depth: past `MAX_DEPTH` it does not
 * descend, because descending is the work that would exhaust the stack. The
 * level it reached is recorded so the refusal can state it.
 */
const walk = (
  members: DeployMember[],
  parentPath: string,
  acc: DeployWalk,
  depth = 1
) => {
  for (const member of members) {
    const name = memberName(member)
    const memberPath = parentPath ? `${parentPath}/${name}` : name

    if (!isSafeSegment(name) && !acc.nameRefusal)
      acc.nameRefusal = {
        code: 400,
        status: 'failure',
        message: `Invalid member name: '${name}'. Member names must be single path segments (no '/', '\\', '..').`
      }

    acc.entries++

    if (member.type === 'folder') {
      if (depth + 1 > MAX_DEPTH) {
        if (!acc.tooDeep) acc.tooDeep = depth + 1

        continue
      }

      walk(member.members, memberPath, acc, depth + 1)

      continue
    }

    const bytes = memberBytes(member)

    acc.totalBytes += bytes

    if (bytes > acc.largest.bytes) acc.largest = { path: memberPath, bytes }
  }
}

/**
 * Measures a tree without touching a drive.
 *
 * Every member is counted, whatever its name: this answers "how big is this
 * tree", and a caller that also needs the names checked is `checkDeployTree`.
 */
export const measureDeployTree = (
  members: DeployMember[]
): DeployMeasurements => {
  const acc = emptyWalk()

  walk(members, '', acc)

  return {
    entries: acc.entries,
    totalBytes: acc.totalBytes,
    largest: acc.largest
  }
}

/**
 * The refusal a file tree earns, or `null` when it can be written.
 *
 * Names are checked first, then the dimensions in a fixed order - entries,
 * total, single file - so a tree breaching two of them is refused for the same
 * one every time, which is what lets a caller key on the message and a test pin
 * it.
 *
 * `limits` defaults to `DEPLOY_LIMITS`; a host may pass its own, stricter set.
 */
export const checkDeployTree = (
  members: DeployMember[],
  limits: DeployLimits = DEPLOY_LIMITS
): DeployRefusal | null => {
  const measured = emptyWalk()

  walk(members, '', measured)

  if (measured.nameRefusal) return measured.nameRefusal

  if (measured.tooDeep)
    return {
      code: 413,
      status: 'failure',
      message: `The file tree is nested too deeply: ${measured.tooDeep} levels (maximum ${MAX_DEPTH}).`
    }

  if (measured.entries > limits.entries)
    return {
      code: 413,
      status: 'failure',
      message: `The file tree exceeds the deploy limit: ${measured.entries} entries (maximum ${limits.entries}).`
    }

  if (measured.totalBytes > limits.totalBytes)
    return {
      code: 413,
      status: 'failure',
      message: `The file tree exceeds the deploy limit: ${describeSize(measured.totalBytes)} (maximum ${describeLimit(limits.totalBytes)}).`
    }

  if (measured.largest.bytes > limits.fileBytes)
    return {
      code: 413,
      status: 'failure',
      message: `A file in the tree exceeds the deploy limit: ${measured.largest.path} is ${describeSize(measured.largest.bytes)} (maximum ${describeLimit(limits.fileBytes)} per file).`
    }

  return null
}

/**
 * The tree's shape, as the wire format states it.
 *
 * A port of `isFileTree` from `@sasjs/utils`, which is what sasjs/server
 * validates with: a tree is an object with a `members` array, and every member
 * is a folder with its own members, or a service/file with a string `code` and
 * a string `name`. Anything else is the `400` the routes already answer.
 */
export const isDeployTree = (value: unknown): value is DeployTree => {
  if (!value || typeof value !== 'object') return false

  const members = (value as DeployTree).members

  return Array.isArray(members) && members.every(isDeployMember)
}

const isDeployMember = (value: unknown): value is DeployMember => {
  if (!value || typeof value !== 'object') return false

  const member = value as DeployMember

  if (typeof member.name !== 'string') return false

  if (member.type === 'folder')
    return Array.isArray(member.members) && member.members.every(isDeployMember)

  if (member.type === 'service' || member.type === 'file')
    return typeof member.code === 'string'

  return false
}

/**
 * Deploys a tree into `appLoc`, or refuses without writing.
 *
 * The order is the promise: shape, then containment, then the cap and the names,
 * and only then the first write. `appLoc` is caller-supplied and every segment
 * must stay a segment, so it is resolved against the drive root and refused when
 * it leaves it - joined naively, a `..` would write outside the drive.
 *
 * A write that fails part-way answers the deploy routes' `500`; the tree before
 * the failure is already on the drive, which the message does not hide.
 */
export const deployTree = async (
  store: DriveStore,
  appLoc: unknown,
  tree: unknown,
  limits: DeployLimits = DEPLOY_LIMITS
): Promise<void> => {
  if (!isDeployTree(tree))
    throw new ApiError(400, 'Provided not supported data format.', {
      status: 'failure',
      message: 'Provided not supported data format.'
    })

  const root = normaliseDrivePath(appLoc)

  if (root === null)
    throw new ApiError(400, 'appLoc cannot be outside drive.', {
      status: 'failure',
      message: 'appLoc cannot be outside drive.'
    })

  const refusal = checkDeployTree(tree.members, limits)

  // the body is the envelope WITHOUT the refusal's own `code`: that field is
  // how a host turns the refusal into a status, and it is not sent
  if (refusal)
    throw new ApiError(refusal.code, refusal.message, {
      status: refusal.status,
      message: refusal.message
    })

  try {
    await writeMembers(store, tree.members, root)
  } catch {
    throw new ApiError(500, 'Deployment failed!', {
      status: 'failure',
      message: 'Deployment failed!'
    })
  }
}

/** Writes every member under `parentPath`, depth first. */
const writeMembers = async (
  store: DriveStore,
  members: DeployMember[],
  parentPath: string
): Promise<void> => {
  for (const member of members) {
    const path = `${parentPath}/${memberName(member)}`

    if (member.type === 'folder') {
      await store.mkdirp(path)
      await writeMembers(store, member.members, path)

      continue
    }

    await store.write(
      path,
      member.type === 'file' ? decodeBase64(member.code) : member.code
    )
  }
}
