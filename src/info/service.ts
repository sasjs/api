/**
 * What a host is, answered once.
 *
 * `GET /SASjsApi/info` is public and pre-auth: the login screen reads it to
 * decide whether to offer a password form and a single sign-on button, so an
 * answer that omits `localLoginEnabled` locks a user out of a form the server
 * would have accepted. It is also the route both hosts answered differently:
 * sasjs/server sends `mode, cors, httpPort, httpsPort, runTimes, authProviders,
 * oidcProviderName?, localLoginEnabled, version`, while the browser build's service
 * worker sent `mode, cors, whiteList, protocol, runTimes` - missing four
 * fields the document requires and carrying two it forbids. A client written
 * against the document could read neither answer portably.
 *
 * The values are the host's - a port, a mode, the run times it installed - and
 * this file cannot know them. What it owns is the shape: the fields the
 * document states, in one order, with the two derivations the server performs -
 * `oidcProviderName` only while `oidc` is a configured provider, and a disabled
 * listener stated as `null` rather than `0`.
 *
 * A host states its configuration once (or as a getter, when a listener or a
 * run time can change without a restart) and answers the route with
 * `createInfoService(...)`. A host configuration the document cannot describe
 * is refused by name at the call rather than served to a client that validates
 * the response and finds an unexpected property.
 */

/**
 * The document's `InfoResponse`, field for field.
 *
 * `additionalProperties: false` is why the type is closed: a host that adds
 * `whiteList` - the CORS whitelist, which sasjs/server deliberately keeps out
 * of a public answer - would be served to every anonymous caller.
 */
export interface InfoResponse {
  /**
   * Which mode the host runs in, from `MODE` - `server` or `desktop` on
   * sasjs/server. Typed as a string because that is what the published document
   * states: sasjs/server#593 types it as the enum so tsoa publishes one, and the
   * refusal below tightens to the two words when that release is vendored here.
   */
  mode: string
  /**
   * The host's CORS setting, from `CORS`. The server passes the variable
   * through, so it is read as a string until sasjs/server#593 states the enum.
   */
  cors: string
  /** The plain HTTP listener's port, or `null` when it is disabled. */
  httpPort: number | null
  /** The TLS listener's port, or `null` when it is disabled. */
  httpsPort: number | null
  /** The run times this host installed, as the execute routes name them. */
  runTimes: string[]
  /** External providers that are configured: `ldap`, `oidc`. */
  authProviders: string[]
  /** The sign-on button's label; absent unless `oidc` is configured. */
  oidcProviderName?: string
  /** Whether password sign-in for local accounts is switched on. */
  localLoginEnabled: boolean
  /**
   * What produced the running build, as `v3.2.2 (4a26a3d)`.
   *
   * The browser build's answer names whatever built the site; this package's
   * own fixture says `dev`, the same fallback `sasjs/server` uses when it has no
   * build stamp. Not optional: the document requires it, and a client that
   * stamps the version in a corner of every screen - the login screen included -
   * reads it before anyone has signed in.
   */
  version: string
}

export interface InfoService {
  /** The answer `GET /SASjsApi/info` sends. */
  info(): Promise<InfoResponse>
}

/**
 * What the browser build answers, and the case the corpus runs.
 *
 * A service worker is a static origin with no listener of its own, no accounts
 * to sign in with, and one run time - the JavaScript one that compiles SAS. The
 * answer says so rather than leaving the login screen to guess: `cors` is
 * `disable` because every request is same-origin, `localLoginEnabled` is false
 * because there is nothing to sign in to, and both ports are `null` because the
 * site is served by whoever serves the site.
 */
export const BROWSER_INFO: InfoResponse = {
  mode: 'desktop',
  cors: 'disable',
  httpPort: null,
  httpsPort: null,
  runTimes: ['js'],
  authProviders: [],
  localLoginEnabled: false,
  version: 'dev'
}

/** The properties the document gives `InfoResponse`, and no others. */
const FIELDS = [
  'mode',
  'cors',
  'httpPort',
  'httpsPort',
  'runTimes',
  'authProviders',
  'oidcProviderName',
  'localLoginEnabled',
  'version'
]

/** The properties the document makes required; `oidcProviderName` is not one. */
const REQUIRED_FIELDS = FIELDS.filter((field) => field !== 'oidcProviderName')

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

/**
 * A port the document can carry: an integer in range, or `null`.
 *
 * `0` is refused rather than read as "disabled": the server answers `null` for
 * a listener it did not start, so a host that states `0` has a different bug
 * from one that states nothing, and collapsing the two is how a client ends up
 * printing port 0.
 */
const portOf = (value: unknown, name: string): number | null => {
  if (value === null || value === undefined) return null

  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new Error(
      `The info configuration states ${name} as ${JSON.stringify(value)}; a port is an integer, or null when the listener is disabled.`
    )

  if (value < 1 || value > 65535)
    throw new Error(
      `The info configuration states ${name} as ${value}; a port is between 1 and 65535, or null when the listener is disabled.`
    )

  return value
}

/** A list of names, with a repeated entry dropped rather than served twice. */
const namesOf = (value: unknown, name: string): string[] => {
  if (!Array.isArray(value))
    throw new Error(
      `The info configuration states ${name} as ${JSON.stringify(value)}; the document states an array of strings.`
    )

  for (const entry of value)
    if (!isNonEmptyString(entry))
      throw new Error(
        `The info configuration states ${name} with an entry that is not a name: ${JSON.stringify(entry)}.`
      )

  return [...new Set(value as string[])]
}

/**
 * The configuration, checked and put in the document's order.
 *
 * Refusals are `Error` rather than `ApiError`: a host that states an
 * impossible configuration is a broken deployment, not a request the API
 * refused, and answering `500` with a message about its own config would blame
 * the caller for it. The messages name the property, because a host developer
 * reading a stack trace wants the line rather than the type.
 */
export const normaliseInfo = (config: InfoResponse): InfoResponse => {
  if (!config || typeof config !== 'object')
    throw new Error('The info configuration is not an object.')

  for (const key of Object.keys(config))
    if (!FIELDS.includes(key))
      throw new Error(
        `The info configuration carries \`${key}\`, which the document's InfoResponse does not state. Remove it: this route is public, so anything else a host puts here is served to an anonymous caller.`
      )

  for (const key of REQUIRED_FIELDS)
    if (!Object.prototype.hasOwnProperty.call(config, key))
      throw new Error(
        `The info configuration does not state \`${key}\`, which the document requires. A client validating the response refuses an answer that omits it.`
      )

  const mode = (config as InfoResponse).mode
  if (!isNonEmptyString(mode) || mode.trim() === '')
    throw new Error(
      `The info configuration states mode as ${JSON.stringify(mode)}; the document states which mode the host runs in.`
    )

  // the document states `cors` as a string and the server passes `CORS` through
  // verbatim, so any word is accepted here. sasjs/server#593 types both as
  // enums; the refusal tightens with the release that publishes them.
  const cors = (config as InfoResponse).cors
  if (!isNonEmptyString(cors) || cors.trim() === '')
    throw new Error(
      `The info configuration states cors as ${JSON.stringify(cors)}; the document states the host's CORS setting.`
    )

  const version = (config as InfoResponse).version
  if (!isNonEmptyString(version) || version.trim() === '')
    throw new Error(
      `The info configuration states version as ${JSON.stringify(version)}; the document states the release that produced the build, such as \`v3.2.2 (4a26a3d)\`.`
    )

  const authProviders = namesOf(config.authProviders, 'authProviders')
  const runTimes = namesOf(config.runTimes, 'runTimes')

  const rawName = (config as InfoResponse).oidcProviderName
  if (rawName !== undefined && !isNonEmptyString(rawName))
    throw new Error(
      `The info configuration states oidcProviderName as ${JSON.stringify(rawName)}; the document states the sign-on button's label, or omits it.`
    )

  if (typeof config.localLoginEnabled !== 'boolean')
    throw new Error(
      `The info configuration states localLoginEnabled as ${JSON.stringify(config.localLoginEnabled)}; the document states a boolean.`
    )

  // the server includes the label only while the provider is configured, and a
  // login screen that offers a button for a provider the server does not have
  // sends the user to a refusal - so the name follows the provider, not the
  // environment variable that set it
  const oidcProviderName =
    rawName !== undefined && authProviders.includes('oidc')
      ? rawName
      : undefined

  return {
    mode,
    cors,
    httpPort: portOf(config.httpPort, 'httpPort'),
    httpsPort: portOf(config.httpsPort, 'httpsPort'),
    runTimes,
    authProviders,
    ...(oidcProviderName === undefined ? {} : { oidcProviderName }),
    localLoginEnabled: config.localLoginEnabled,
    version
  }
}

/**
 * The info service, over the host's own configuration.
 *
 * A function is accepted because the answer can change while the process runs -
 * sasjs/server reads `process.runTimes`, which a desktop install can extend -
 * and reading it per request is what keeps a started host's answer true.
 */
export const createInfoService = (
  config: InfoResponse | (() => InfoResponse)
): InfoService => {
  const read = () => (typeof config === 'function' ? config() : config)

  return {
    async info() {
      return normaliseInfo(read())
    }
  }
}
