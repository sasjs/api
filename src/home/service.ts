/**
 * The web interface's shell - the one page every host serves at `/`.
 *
 * The document states what the route is for: "Serves the web interface's
 * `index.html`, with the current bundle version appended so a returning browser
 * loads the updated bundle." That is the whole decision, and it is the same one
 * on every host:
 *
 *   - the SPA bundle has a fixed name (`index.bundle.js`), so a browser that
 *     keeps the previous build cached goes on rendering the previous interface
 *     after an update. A login screen once kept offering a password form the new
 *     server refused, and only a cache-disabled reload showed the new screen. The
 *     token is derived from the bundle's contents, so it changes with every build
 *     and is stable within one;
 *   - only an attribute naming the bundle is rewritten, so the same words in
 *     prose are left as prose;
 *   - a reference that already carries a query string is left alone, so applying
 *     this twice cannot produce a second `?v=`;
 *   - a host with no build answers a page saying so, rather than an error: a
 *     missing bundle costs a stale page at worst, and must never be the reason a
 *     deployment cannot render its own app.
 *
 * The host still reads the file and computes the digest - a hash of a megabyte
 * bundle is the host's to make, and the package compiles with no node built-ins
 * and no DOM `crypto`. What it cannot be left to each host is the rule that
 * turns the two into the page, which is why it lives here.
 */

/** The entry bundle the served page references. */
export const BUNDLE_NAME = 'index.bundle.js'

/**
 * What a host with no web build answers.
 *
 * A page rather than a `404`: the route is the interface, and an operator whose
 * build did not land needs to see that from the browser rather than from a JSON
 * error. The wording is sasjs/server's, so an adopting host changes nothing a
 * user or a smoke test already reads.
 */
export const NO_WEB_BUILD =
  '<html><head></head><body>Web Build is not present</body></html>'

/** What the host hands over: the page it read, and the token it computed. */
export interface WebPage {
  /** The shell document, as it was read. */
  html: string
  /**
   * The cache-busting token for the bundle the page references - a digest of the
   * bundle's contents, twelve characters in sasjs/server's implementation.
   */
  version: string
}

export interface HomeService {
  /** The page to send with a `200`, as `text/html`. */
  home(): Promise<string>
}

/** An attribute whose value names a file; quoted or not, both are valid. */
const FILE_ATTRIBUTE = /(\s(?:src|href)=)("[^"]*"|'[^']*'|[^\s>]+)/g

/**
 * A reference that names the bundle file itself.
 *
 * Anchored at the end (and at a path boundary) rather than `includes`, so an
 * asset whose name merely begins with the bundle's - `index.bundle.js.css` - is
 * left alone: it is a different file, and stamping it would suggest the token
 * described something it did not.
 */
const BUNDLE_REFERENCE = new RegExp(
  `(^|/)${BUNDLE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
)

/**
 * The page with its bundle reference carrying that token.
 *
 * Only an attribute naming the bundle is rewritten. A reference that already
 * carries a query string is left alone, so applying this twice is the same as
 * applying it once.
 */
export const withBundleVersion = (html: string, version: string): string =>
  html.replace(FILE_ATTRIBUTE, (match, attribute: string, value: string) => {
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : ''
    const target = quote ? value.slice(1, -1) : value

    if (!BUNDLE_REFERENCE.test(target) || target.includes('?')) return match

    return `${attribute}${quote}${target}?v=${version}${quote}`
  })

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

/**
 * The page, checked and stamped.
 *
 * A version is a query-string token: whitespace or a `?`/`#` would produce a URL
 * that does not resolve, and a host that computed one from the wrong input would
 * otherwise serve a broken reference rather than noticing.
 */
const pageOf = (page: WebPage): string => {
  if (!page || typeof page !== 'object')
    throw new Error('The web page is not an object.')

  if (!isNonEmptyString(page.html))
    throw new Error(
      'The web page states no html, so there is nothing to serve. Answer `undefined` from the port when the host has no build.'
    )

  // a token, not text: the value is written into a quoted attribute, so a
  // quote closes it early and serves a broken reference - the failure this
  // check exists to stop. A digest is `[0-9a-f]`, so the set below is strict
  // enough to be safe and wide enough for any host's chosen encoding
  if (
    !isNonEmptyString(page.version) ||
    !/^[A-Za-z0-9._-]+$/.test(page.version)
  )
    throw new Error(
      `The web page states version as ${JSON.stringify(page.version)}; it is the bundle's cache token, so it may contain only letters, digits, ".", "_" and "-" - anything else, a quote above all, would end the attribute it is written into.`
    )

  return withBundleVersion(page.html, page.version)
}

/**
 * The home service, over the host's own page.
 *
 * The port answers `undefined` when this host has no web build - a packaged
 * server whose build folder is absent, a host that only answers the API - and
 * the service answers the documented page rather than an error.
 */
export const createHomeService = (
  page: () => Promise<WebPage | undefined>
): HomeService => ({
  async home() {
    const found = await page()
    return found === undefined ? NO_WEB_BUILD : pageOf(found)
  }
})
