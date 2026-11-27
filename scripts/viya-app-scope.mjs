/**
 * Regenerate the application inventory, or check that it still matches the app.
 *
 * The house pattern (`scripts/viya-scope.mjs`): `npm run sync:app-scope` writes,
 * `npm run check:app-scope` is the guard and exits non-zero when the committed
 * inventory and the application disagree.
 *
 * The application is not a dependency of this package - it is a product built
 * from another repository - so a checkout is named on the command line or in
 * `APP_SOURCE`. There is no default: measuring the wrong tree would rewrite the
 * inventory with another application's calls and call that a pass.
 *
 * The inventory states the platform namespaces it measured, because that list
 * decides what counts as a platform call at all - see `PLATFORM_ROOTS` in
 * `scripts/app-surface.mjs`. It does not state the application's commit or its
 * branch: both move for reasons that cannot change a call, and an inventory that
 * reddens on every unrelated release, or on a branch being cut, is one somebody
 * switches off.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extract, PLATFORM_ROOTS } from './app-surface.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = join(root, 'spec/viya/app-paths.json')
const check = process.argv.includes('--check')

const given =
  process.argv.slice(2).find((argument) => !argument.startsWith('--')) ||
  process.env.APP_SOURCE

if (!given) {
  console.error(
    'Name the application checkout to measure.\n' +
      '  npm run check:app-scope -- /path/to/data-controller\n' +
      'or set APP_SOURCE=/path/to/data-controller.\n' +
      'The inventory is measured from the application, so there is nothing to ' +
      'compare without one - and guessing which tree was meant would measure a ' +
      'different client.'
  )
  process.exit(2)
}

const source = resolve(given)

/** The source folder the inventory measures, relative to the checkout. */
const MEASURED_FROM = 'client/src'

const sourceDir = join(source, MEASURED_FROM)

const inventory = {
  application: 'Data Controller for SAS',
  repository: 'https://git.datacontroller.io/dc/dc',
  measuredFrom: MEASURED_FROM,
  roots: [...PLATFORM_ROOTS].sort(),
  paths: extract(sourceDir, { root: sourceDir })
}

const rendered = JSON.stringify(inventory, null, 2) + '\n'

if (!check) {
  writeFileSync(outPath, rendered, 'utf8')
  console.log(
    `wrote ${outPath}: ${Object.keys(inventory.paths).length} platform paths from ${sourceDir}`
  )
  process.exit(0)
}

const committed = readFileSync(outPath, 'utf8')

if (committed === rendered) {
  console.log(
    `the inventory matches the application: ${Object.keys(inventory.paths).length} platform paths`
  )
  process.exit(0)
}

const before = JSON.parse(committed)
const added = Object.keys(inventory.paths).filter(
  (path) => !(path in before.paths)
)
const removed = Object.keys(before.paths).filter(
  (path) => !(path in inventory.paths)
)
const moved = Object.keys(before.paths).filter(
  (path) =>
    path in inventory.paths &&
    JSON.stringify(before.paths[path]) !== JSON.stringify(inventory.paths[path])
)
const newRoots = inventory.roots.filter(
  (namespace) => !before.roots.includes(namespace)
)
const droppedRoots = before.roots.filter(
  (namespace) => !inventory.roots.includes(namespace)
)

const causes = []

if (added.length) causes.push(`the application now names: ${added.join(', ')}`)

if (removed.length)
  causes.push(`the application no longer names: ${removed.join(', ')}`)

if (moved.length)
  causes.push(
    `the same paths are now named from other files: ${moved.join(', ')}`
  )

if (newRoots.length)
  causes.push(`the measured namespaces now include: ${newRoots.join(', ')}`)

if (droppedRoots.length)
  causes.push(
    `the measured namespaces no longer include: ${droppedRoots.join(', ')}`
  )

if (!causes.length)
  causes.push('the extracts differ in a way this check cannot name')

console.error(
  'The committed inventory does not describe the application:\n  ' +
    causes.join('\n  ') +
    '\nRun `npm run sync:app-scope -- <checkout>`, then decide each new path in ' +
    'src/viya/appSurface.ts (and add the operation to src/viya/declared.ts when ' +
    'the decision is "in") - a path the application calls and this package has ' +
    'not classified is a screen that answers 404 on an emulated estate.'
)
process.exit(1)
