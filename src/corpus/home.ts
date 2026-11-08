import type { CorpusCase } from './drive.js'
import type { WebPage } from '../home/service.js'

/**
 * The shell the corpus host serves.
 *
 * A bundle reference the stamping rule must rewrite, a second reference that
 * already carries a query string (left alone, which is what makes the transform
 * idempotent), a stylesheet whose name merely begins with the bundle's (left
 * alone, which is where this rule differs from sasjs/server's `includes`), and
 * the bundle's name in prose (left as prose). The page a real host reads looks
 * like this; the values are a fixture so a case can pin the exact bytes.
 */
export const CORPUS_WEB_PAGE: WebPage = {
  version: '4a26a3d1b2c3',
  html: [
    '<!doctype html>',
    '<html>',
    '<head>',
    '  <script src="./index.bundle.js"></script>',
    '  <script src="./vendor.js?v=keepme"></script>',
    '  <link rel="stylesheet" href="./index.bundle.css" />',
    // a name that merely begins with the bundle's: stamped by an `includes`
    // match, left alone here - see BUNDLE_REFERENCE
    '  <link rel="stylesheet" href="./index.bundle.js.css" />',
    '</head>',
    '<body>',
    '  <p>The page loads index.bundle.js from the folder beside it.</p>',
    '  <div id="root"></div>',
    '</body>',
    '</html>'
  ].join('\n')
}

/**
 * The body that page must answer with: the bundle reference stamped, the
 * already-versioned one and the prose untouched.
 */
export const CORPUS_WEB_BODY = CORPUS_WEB_PAGE.html.replace(
  './index.bundle.js"',
  `./index.bundle.js?v=${CORPUS_WEB_PAGE.version}"`
)

/**
 * The home corpus.
 *
 * The document states one status, `200` as `text/html`; what a client cannot see
 * is that the page's bundle reference carries the build's token. That is what the
 * case pins, because a browser holding the previous build is the failure this
 * route exists to prevent.
 */
export const HOME_CORPUS: CorpusCase[] = [
  {
    id: 'home-answers-the-stamped-shell',
    route: 'GET /',
    description:
      'answers the shell with its bundle reference stamped, leaving prose and an already-versioned reference alone',
    request: {},
    expect: { status: 200, contents: CORPUS_WEB_BODY }
  }
]
