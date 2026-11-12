/**
 * The values that identify the emulated estate, in one place.
 *
 * They live apart from the handlers because two handler modules need them: the
 * folder family derives a folder id, the compute family derives a context and a
 * server id, and a module that imports the other's handler map to reach them
 * would be a cycle.
 */

/** The emulated clock: a fixed instant, so a body is reproducible. */
export const EMULATED_NOW = '2026-01-01T00:00:00.000Z'

/** The caller the emulated estate reports when a host does not name one. */
export const EMULATED_USER = { id: 'emulated-user', name: 'Emulated User' }

/**
 * A uuid shape from a string, deterministically.
 *
 * Two 32-bit FNV-1a passes give enough of a hash to fill a uuid's fields, and the
 * version/variant nibbles are set so the result is a well-formed v4-shaped id.
 * Collisions are possible in principle and irrelevant here: the id is a handle
 * the emulator hands back, not a uniqueness guarantee.
 */
export const idFor = (path: string, kind = 'folder'): string => {
  const hash = (input: string, seed: number) => {
    let value = seed
    for (let index = 0; index < input.length; index++) {
      value ^= input.charCodeAt(index)
      value = Math.imul(value, 16777619) >>> 0
    }
    return value.toString(16).padStart(8, '0')
  }

  const raw =
    hash(`${kind}:${path}`, 2166136261) +
    hash(`${kind}:${path}`, 2246822519) +
    hash(`${kind}:${path}`, 3266489917) +
    hash(`${kind}:${path}`, 668265263)

  const hex = raw.slice(0, 32)

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32)
  ].join('-')
}

/**
 * One folder path, however it was spelled.
 *
 * The adapter joins a root of '/' to a path of '/app' and sends '//app', which is
 * a different string and - because an id is derived from the path - a different
 * id. A client that then asks for that id is asking about a folder the drive does
 * not have, so every path is collapsed to one spelling before anything derives
 * from it.
 */
export const normalisePath = (path: string): string => {
  const collapsed = `/${path}`.replace(/\/{2,}/g, '/')

  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed
}
