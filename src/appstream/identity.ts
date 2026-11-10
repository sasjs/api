import { normaliseDrivePath } from '../drive/paths.js'
import { ApiError } from '../types.js'

/**
 * An app's id is a UUID assigned once, when the app is first published.
 *
 * Not a hash of anything. Hashing a location was tried and removed: it made the id
 * a function of the path, which forced rules on what a path may look like (lowercase
 * only, no spaces) to keep the hash unambiguous, and it needed a hash implementation
 * that worked identically in Node and in the browser worker the mock drive runs in.
 * A UUID needs none of that: it is generated once, stored, and looked up by `appLoc`
 * when the same folder is published again, so republishing restores the id while the
 * path stays free to be whatever the drive allows.
 *
 * The readable NAME is the label - what a person sees and what a URL shows. The id
 * is the key: what the registry, the routes and the permission rules point at.
 */
export const normaliseAppLoc = (appLoc: string): string => {
  // An absent location is not the root: coercing it to one would register every
  // caller that forgot to pass an appLoc against the root app's entry.
  if (typeof appLoc !== 'string' || appLoc === '')
    throw new Error(
      `App location must be a non-empty string, got ${JSON.stringify(appLoc)}.`
    )

  const normalised = normaliseDrivePath(appLoc)

  // one refusal for one rule: the deploy route refuses an escaping location with
  // this wording and this status, and a host calling in here gets the same
  if (normalised === null)
    throw new ApiError(400, 'appLoc cannot be outside drive.')

  return normalised
}

/**
 * A new id: a version 4 UUID.
 *
 * `crypto.randomUUID` exists in Node and in a browser worker on https or localhost,
 * which is where the mock drive runs. The fallback builds the same thing from
 * `getRandomValues` rather than from `Math.random`, so a weaker environment does not
 * quietly produce a weaker id.
 */
export const newAppId = (): string => {
  const webCrypto = (
    globalThis as {
      crypto?: {
        randomUUID?: () => string
        getRandomValues?: (bytes: Uint8Array) => Uint8Array
      }
    }
  ).crypto

  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()

  if (typeof webCrypto?.getRandomValues !== 'function')
    throw new Error('No cryptographic source of randomness is available.')

  const bytes = new Uint8Array(16)

  webCrypto.getRandomValues(bytes)

  // version 4, variant 10xx
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-')
}

// no `i` flag: `newAppId` mints lower case and every lookup compares exactly, so
// a guard that accepts upper case would vouch for an id no lookup can find
const APP_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Whether a string is a well-formed id: a version 4 UUID. */
export const isAppId = (value: unknown): value is string =>
  typeof value === 'string' && APP_ID.test(value)
