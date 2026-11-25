/**
 * The three builds load, and they describe the same API.
 *
 * Each artifact is loaded the way its consumer loads it: `require` for the CJS
 * build, `import` for the ESM one, and an evaluation with `self` in scope for
 * the browser bundle, because that artefact is a classic-worker IIFE rather
 * than a module.
 *
 * They are compared as SETS OF OPERATION IDS, not as counts and not against a
 * literal. A count was wrong in both directions: it went stale when the table
 * grew to 62 in #78 and reddened `main` for a day, and a bundle carrying 62
 * different operations under the same length still passed. An id is
 * `METHOD /path`, so a stale or partly tree-shaken bundle names the operations
 * it lost, which is what this step exists to catch.
 */
import { createRequire } from 'node:module'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const checkWorkerSession = async (api) => {
  const services = { drive: api.createDriveService(new api.MemoryDriveStore()) }
  const contexts = await api.dispatchViya(services, 'GET', '/compute/contexts')
  const { id } = contexts.body.items[0]
  const path = `/compute/contexts/${id}/sessions`
  const uuidV4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  const created = await api.dispatchViya(services, 'POST', path)
  if (created.status !== 201 || !uuidV4.test(created.body.id))
    throw new Error(
      `compute session did not get a UUID v4: ${JSON.stringify(created.body)}`
    )

  const state = created.body.links.find(({ rel }) => rel === 'state')
  const read = await api.dispatchViya(services, 'GET', state.href)
  if (read.status !== 200 || read.body !== 'idle')
    throw new Error('compute session state link did not round-trip')
}

const problems = []

/**
 * Every artifact must expose a non-empty table and the service factories.
 * Returns the operation ids, or undefined when the artifact is unusable.
 */
const inspect = (name, api) => {
  if (!api) {
    problems.push(`${name}: nothing exported`)
    return undefined
  }

  const ids = (api.ROUTES ?? []).map((route) => route.id)

  if (!ids.length) {
    problems.push(`${name}: ROUTES is empty or missing`)
    return undefined
  }

  if (ids.some((id) => typeof id !== 'string')) {
    problems.push(
      `${name}: a route carries no id, so its operations cannot be compared`
    )
    return undefined
  }

  for (const factory of ['createDriveService', 'createIdentityService'])
    if (typeof api[factory] !== 'function')
      problems.push(`${name}: ${factory} is not a function`)

  return ids
}

/**
 * Loading is part of the check: a build that throws on load - a missing
 * dependency, a bundle truncated under `vm` - is reported with the artifact's
 * name, rather than as a stack trace before any finding is printed.
 */
const load = async (name, loader) => {
  try {
    return inspect(name, await loader())
  } catch (error) {
    problems.push(
      `${name}: threw while loading - ${String(error?.message ?? error)}`
    )
    return undefined
  }
}

const cjs = await load('cjs', () => require(join(root, 'build/cjs/index.js')))
const esm = await load('esm', () => import(join(root, 'build/esm/index.js')))

const browser = await load('browser', async () => {
  // Exercise the browser bundle with the crypto exposed by older workers.
  const context = {
    self: {},
    crypto: { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) }
  }
  vm.createContext(context)
  vm.runInContext(readFileSync(join(root, 'build/browser.js'), 'utf8'), context)

  const api = context.self.SASjsApi
  await checkWorkerSession(api)
  return api
})

/** The first few, with a count, so a fully stale bundle stays readable. */
const list = (ids) =>
  ids.length <= 6
    ? ids.join(', ')
    : `${ids.slice(0, 6).join(', ')}, and ${ids.length - 6} more`

/** Each artifact against the CJS build, in both directions. */
if (cjs) {
  const reference = new Set(cjs)

  for (const [name, ids] of [
    ['esm', esm],
    ['browser', browser]
  ]) {
    if (!ids) continue

    const other = new Set(ids)
    const missing = cjs.filter((id) => !other.has(id))
    const extra = ids.filter((id) => !reference.has(id))

    if (missing.length)
      problems.push(`${name} is missing ${missing.length}: ${list(missing)}`)

    if (extra.length)
      problems.push(
        `${name} carries ${extra.length} the cjs build does not: ${list(extra)}`
      )
  }
}

if (problems.length) {
  console.error(
    `The builds do not agree.\n${problems.map((problem) => `  - ${problem}`).join('\n')}`
  )
  process.exit(1)
}

console.log(
  `all three builds load, and describe the same ${cjs.length} operations`
)
console.log(
  'the worker build issues UUID v4 compute sessions with getRandomValues'
)
