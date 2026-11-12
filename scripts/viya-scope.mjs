/**
 * Regenerate the adapter inventory, or check that it still matches the adapter.
 *
 * The house pattern (`scripts/sync-routes.mjs`): `npm run sync:scope` writes,
 * `npm run check:scope` is the CI guard and exits non-zero when the committed
 * inventory and the installed adapter disagree.
 *
 * The adapter is read from the capture tool's tree, because that tool pins the
 * version the captures were taken against - one pin, two consumers, rather than
 * a second dependency in this package.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extract } from '../tools/viya-capture/surface.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const adapterDir = join(root, 'tools/viya-capture/node_modules/@sasjs/adapter')
const outPath = join(root, 'spec/viya/adapter-paths.json')
const check = process.argv.includes('--check')

const require = createRequire(import.meta.url)

let version

try {
  version = require(join(adapterDir, 'package.json')).version
} catch {
  console.error(
    `The adapter is not installed at ${adapterDir}.\n` +
      'Run `npm ci --prefix tools/viya-capture`, then try again - the inventory ' +
      'is measured from the adapter, so there is nothing to compare without it.'
  )
  process.exit(2)
}

const inventory = {
  adapter: version,
  extractedFrom: 'node_modules/@sasjs/adapter',
  paths: extract(adapterDir)
}

const rendered = JSON.stringify(inventory, null, 2) + '\n'

if (!check) {
  writeFileSync(outPath, rendered, 'utf8')
  console.log(
    `wrote ${outPath}: ${Object.keys(inventory.paths).length} paths from @sasjs/adapter ${version}`
  )
  process.exit(0)
}

const committed = readFileSync(outPath, 'utf8')

if (committed === rendered) {
  console.log(
    `the inventory matches @sasjs/adapter ${version}: ${Object.keys(inventory.paths).length} paths`
  )
  process.exit(0)
}

const before = JSON.parse(committed).paths
const after = inventory.paths
const added = Object.keys(after).filter((path) => !(path in before))
const removed = Object.keys(before).filter((path) => !(path in after))

const committedVersion = JSON.parse(committed).adapter
const moved = Object.keys(before).filter(
  (path) =>
    path in after &&
    JSON.stringify(before[path]) !== JSON.stringify(after[path])
)

/**
 * Why the two disagree, computed rather than assumed.
 *
 * The first version said "the same literals now live elsewhere" whenever no
 * path had been added or removed - including when the only difference was a new
 * adapter version, where that sentence names a cause nobody checked. A guard's
 * message is read by whoever has to fix it, so it states what it found.
 */
const causes = []

if (committedVersion !== version)
  causes.push(`the inventory was measured from ${committedVersion}`)

if (added.length) causes.push(`the adapter now names: ${added.join(', ')}`)

if (removed.length)
  causes.push(`the adapter no longer names: ${removed.join(', ')}`)

if (moved.length)
  causes.push(
    `the same paths are now named from other files: ${moved.join(', ')}`
  )

if (!causes.length)
  causes.push('the extracts differ in a way this check cannot name')

console.error(
  `The committed inventory does not describe @sasjs/adapter ${version}:\n  ` +
    causes.join('\n  ') +
    '\nRun `npm run sync:scope`, then decide each new path in src/viya/surface.ts - ' +
    'a path the adapter calls and this package has not classified is scope creep ' +
    'that nobody chose.'
)
process.exit(1)
