/**
 * What the emulated estate derives its generated data from.
 *
 * The emulator cannot execute SAS, so any answer that a real engine would produce
 * - a job log, a listing, a webout - is generated. Generated data is only useful
 * if it is the same data twice: a screenshot taken after a build must still be
 * true after the next one, and a fixture committed today must match the answer
 * tomorrow.
 *
 * The seed is therefore the identity of the estate, and the identity of an estate
 * is the address clients already use to reach it. A target that points at
 * `http://localhost:5000` and a target that points at `http://127.0.0.1:5000` are
 * the same estate spelled two ways, so the address is normalised before it is
 * hashed - and `seed` exists for the two cases where the address is the wrong
 * identity: the estate reached by a different hostname (a container name, a LAN
 * address), and the port that moves between runs (CI picks an ephemeral one).
 *
 * Absent both, every emulated estate shares one seed. That is the only honest
 * default: an emulator with no address has not told us which estate it is.
 */

/** The seed every emulated estate falls back to. */
export const DEFAULT_SEED = 'emulated'

export interface ViyaSeedSettings {
  /** The address this estate answers at. */
  serverUrl?: string
  /** Pins the generated data when the address is not the identity. */
  seed?: string | number
}

/**
 * The address reduced to what identifies it.
 *
 * Lowercased host, no default port, no trailing slash, no path: `https://Viya.Example.com:443/SASDrive/`
 * and `https://viya.example.com` are one estate, and a path is where a client
 * lands rather than which server it is. A non-default port stays, because two
 * emulators on one machine are two estates.
 */
export const normaliseServerUrl = (url: string | undefined): string => {
  if (!url) return ''

  const trimmed = url.trim()

  if (!trimmed) return ''

  // parsed by hand rather than with `new URL`, because the browser build has no
  // URL global and this module is part of it
  const match = /^(?:([a-z][a-z0-9+.-]*):\/\/)?([^/?#]+)/i.exec(trimmed)

  if (!match) return trimmed.replace(/\/+$/, '').toLowerCase()

  const scheme = (match[1] ?? 'http').toLowerCase()

  let authority = match[2].toLowerCase()

  const credentials = authority.lastIndexOf('@')

  if (credentials >= 0) authority = authority.slice(credentials + 1)

  let host = authority
  let port = ''

  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')

    if (close >= 0) {
      host = authority.slice(0, close + 1)

      if (authority[close + 1] === ':') port = authority.slice(close + 2)
    }
  } else {
    const colon = authority.lastIndexOf(':')

    if (colon >= 0) {
      host = authority.slice(0, colon)
      port = authority.slice(colon + 1)
    }
  }

  const isDefault =
    (scheme === 'http' && port === '80') ||
    (scheme === 'https' && port === '443')

  // a non-default port stays: two emulators on one machine are two estates
  return `${scheme}://${host}${port && !isDefault ? `:${port}` : ''}`
}

/** A 32-bit FNV-1a hash, so one string becomes one number. */
export const hash = (input: string): number => {
  let value = 2166136261

  for (let index = 0; index < input.length; index++) {
    value ^= input.charCodeAt(index)
    value = Math.imul(value, 16777619) >>> 0
  }

  return value >>> 0
}

/**
 * The number that makes this estate's generated data reproducible.
 *
 * `seed` wins over the address when both are present: it is the override a host
 * reaches for when the address disagrees with the estate, not a second opinion
 * the address gets to overrule.
 */
export const seedOf = (settings: ViyaSeedSettings = {}): number => {
  if (settings.seed !== undefined && settings.seed !== '')
    return hash(`seed:${settings.seed}`)

  const address = normaliseServerUrl(settings.serverUrl)

  return hash(`url:${address || DEFAULT_SEED}`)
}

/**
 * A uniform generator over one seed (mulberry32).
 *
 * Every draw advances the same 32-bit state, so a sequence is a function of the
 * seed alone - which is the whole point: the same estate answers the same way,
 * and two estates answer differently.
 */
export const generator = (seed: number): (() => number) => {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0

    let value = state

    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** An integer in `[0, bound)`, drawn from the generator. */
export const drawInt = (next: () => number, bound: number): number =>
  Math.floor(next() * bound)

/** A line from a list, drawn from the generator. */
export const drawFrom = <T>(next: () => number, values: T[]): T =>
  values[drawInt(next, values.length)]
