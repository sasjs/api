/**
 * The three builds load, and they describe the same API.
 *
 * Each artifact is loaded the way its consumer loads it: `require` for the CJS
 * build, `import` for the ESM one, and an evaluation with `self` in scope for
 * the browser bundle, because that artefact is a classic-worker IIFE rather
 * than a module.
 *
 * The count is compared BETWEEN the artifacts, not against a number written in
 * this file. It was compared against a literal, and the literal became wrong:
 * the table grew to 62 operations in #78, both node jobs failed
 * `All three builds load` on every pull request after it, and nothing in the
 * diff of those pull requests could explain it. A count that has to be edited
 * whenever an operation is added is a fuse on the wrong circuit - what matters
 * is that a full build of the package and a bundle of it agree, and that the
 * bundle still exports what a host calls.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const problems = []

/** Every artifact must expose a non-empty table and the service factories. */
const inspect = (name, api) => {
  if (!api) return problems.push(`${name}: nothing exported`)

  const count = api.ROUTES?.length

  if (!count) problems.push(`${name}: ROUTES is empty or missing`)

  for (const factory of ['createDriveService', 'createIdentityService'])
    if (typeof api[factory] !== 'function')
      problems.push(`${name}: ${factory} is not a function`)

  return count
}

const cjs = inspect('cjs', require(join(root, 'build/cjs/index.js')))
const esm = inspect('esm', await import(join(root, 'build/esm/index.js')))

const context = { self: {} }
vm.createContext(context)
vm.runInContext(readFileSync(join(root, 'build/browser.js'), 'utf8'), context)
const browser = inspect('browser', context.self.SASjsApi)

if (cjs && esm && browser && new Set([cjs, esm, browser]).size !== 1)
  problems.push(
    `the artifacts disagree: cjs ${cjs}, esm ${esm}, browser ${browser} operations`
  )

if (problems.length) {
  console.error(
    `The builds do not agree.\n${problems.map((p) => `  - ${p}`).join('\n')}`
  )
  process.exit(1)
}

console.log(`all three builds load, and carry the same ${cjs} operations`)
