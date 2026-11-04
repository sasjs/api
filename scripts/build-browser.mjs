/**
 * The browser artefact: one file a classic worker loads with `importScripts`.
 *
 * The two host builds (cjs, esm) are for node and for a bundler. A service
 * worker registered by a static site has neither - it has `importScripts` and
 * no module loader - and the CLI's mock build copies its assets verbatim rather
 * than running a bundler over them. So the bundling belongs here, once, and the
 * consumer just copies `build/browser.js` next to its own runtime.
 *
 * Not minified: the browser build is an artefact people debug in a Network tab
 * next to their own services, and the file is small.
 */
import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile: join(root, 'build', 'browser.js'),
  bundle: true,
  format: 'iife',
  globalName: 'SASjsApi',
  target: ['es2020'],
  platform: 'neutral',
  charset: 'utf8',
  legalComments: 'none',
  banner: {
    // deliberately no version: package.json carries a placeholder until
    // semantic-release bumps it, and the build runs before that step, so a
    // version here would be a number the artefact never shipped as
    js: `/* @sasjs/api - the SASjs Server API, for a service worker. https://github.com/sasjs/api */`
  },
  footer: {
    // `globalName` declares a var; a worker's global scope is `self`, and a host
    // that loads this with importScripts reads it from there
    js: `if (typeof self !== 'undefined') self.SASjsApi = SASjsApi`
  }
})

console.log('wrote build/browser.js')
