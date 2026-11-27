/**
 * What the emulated estate derives its generated data from.
 *
 * The emulator cannot execute SAS, so any answer that a real engine would produce
 * - a job log, a listing, a webout - is generated. Generated data is only useful
 * if it is the same data twice: a screenshot taken after a build must still be
 * true after the next one, and a fixture committed today must match the answer
 * tomorrow.
 *
 * The seed is therefore what the estate's *generated data* draws from, and the
 * identity of an estate is the address clients already use to reach it,
 * normalised so that one estate spelled two ways is one string. There is no
 * override: an address that differs is a different estate with different data,
 * by design. Anything that reads this data - a fixture, a screenshot, a test -
 * has to work whatever the address is, because the address is all the identity
 * there is.
 *
 * The seed is a 32-bit digest of that address, which is wide enough to vary the
 * generated numbers and narrow enough that two distinct addresses collide on it
 * - by birthday, roughly one pair per few-billion addresses, and a search finds
 * one in minutes. A collision makes two estates answer with the same numbers,
 * which is cosmetic; anything that *stores* state per estate - the live session
 * registry - must therefore key by the full address, never by the seed, and
 * `estateKeyOf` is that key.
 *
 * An emulator with no address has not said which estate it is, so every such
 * estate shares one seed. That is the only honest default.
 */

/** The seed every emulated estate falls back to. */
export const DEFAULT_SEED = 'emulated'

/**
 * What a host does when the emulated estate is asked to run a program.
 *
 * Absent, the emulator generates a log and says so: it has no engine, which is
 * the whole reason its answers are seeded. Present, the host runs the program on
 * whatever engine it has and returns what the program produced - which is what
 * makes an application's `_webout` real rather than generated.
 */
export interface ViyaExecutor {
  execute(request: {
    /** The program: a string, or the lines the client sent. */
    program: string | string[]
    /** The session variables the client attached to the job. */
    variables?: Record<string, string>
    /** The job's name, which the adapter sets to the service path. */
    name?: string
    /** The session the job belongs to. */
    sessionId: string
  }): Promise<ViyaRun>
}

/** What an engine answers for one program. */
export interface ViyaRun {
  /** The program's `_webout` content, when it produced one. */
  webout?: string
  /** The log the program produced, as one string with lines separated by `\n`. */
  log: string
  /**
   * How the run ended.
   *
   * The trusted host supplies this explicitly, never inferred from the log.
   * `warning` and `error` are Compute outcomes; `failed` preserves the existing
   * host/infrastructure failure state. Absent, the run completed.
   */
  state?: 'completed' | 'warning' | 'error' | 'failed'
  /** Trusted host's integer SYSCC, when known. Not inferred from the log. */
  jobConditionCode?: number
}

export interface ViyaSeedSettings {
  /** The address this estate answers at, which is what seeds it. */
  serverUrl?: string
  /** Runs a submitted program, when the host has an engine. */
  execute?: ViyaExecutor['execute']
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
 * The address is the only input: the same estate answers the same way every time,
 * and a different address is a different estate. A 32-bit digest, so it varies
 * the numbers - it is not the estate's identity for anything that stores state
 * (see `estateKeyOf`).
 */
export const seedOf = (settings: ViyaSeedSettings = {}): number => {
  const address = normaliseServerUrl(settings.serverUrl)

  return hash(`url:${address || DEFAULT_SEED}`)
}

/**
 * The key a per-estate store is held under: the full normalised address.
 *
 * The seed is a 32-bit digest of this key, and two distinct addresses collide
 * on it - a pair exists for any such digest, and a search finds one in
 * minutes. A registry keyed by the seed would then hand two addresses one
 * shared store, so state is keyed by the address itself: distinct addresses
 * are distinct stores even when their seeds are one number, and two spellings
 * of one address (which normalise to one string) remain one store.
 */
export const estateKeyOf = (settings: ViyaSeedSettings = {}): string => {
  const address = normaliseServerUrl(settings.serverUrl)

  return address || DEFAULT_SEED
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
