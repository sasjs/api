/**
 * What an application asks the Viya platform for, extracted from the application.
 *
 * The emulator's scope began as the adapter's call surface, measured by
 * `tools/viya-capture/surface.mjs`. That is the right client to measure until an
 * application calls the platform itself: Data Controller's client speaks Viya
 * REST directly for the calls the adapter does not offer (`/identities/groups`,
 * the folder members, the compute contexts it lists), and a capture pass driven
 * by the adapter can never see them. Those calls are the ones a visitor loses
 * first - the deploy screen's admin-group lookup is fatal - so the emulator has
 * to answer them, and a scope declared from a capture it cannot take would be a
 * claim nothing checks.
 *
 * So the application is measured too, by the same rules: every path literal it
 * builds is listed, normalised to a template, and classified in
 * `src/viya/appSurface.ts`. The extraction is deliberately blind to the verb -
 * the verb lives at the call site, not in the string.
 *
 * Two limits, both stated rather than hidden:
 *
 * - a path assembled from fragments (`'/identities/groups/' + id + '/members'`)
 *   is measured as the fragment that ends at a separator, which normalises to
 *   `/identities/groups/{}`. That is a prefix, and `covers()` in
 *   `spec/viyaTable.spec.ts` already treats a trailing `{}` as a prefix - the
 *   same way it treats the adapter's `/files/files/` + a file's content.
 * - it reads sources, not a bundle. A path built by a library the application
 *   bundles is the library's call, and the library is measured where it lives.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  isPathLike,
  literalsIn,
  normalise
} from '../tools/viya-capture/surface.mjs'

/** Folders whose path literals are not calls the application makes. */
const SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'assets',
  'vendor',
  // a spec's literals are fixture values a test hands to a stub, not requests
  // the product makes: counting them would demand an operation for a URL that
  // only ever exists inside a test
  'cypress'
])

/**
 * The platform namespaces the application's own screens speak.
 *
 * An application's source names two very different kinds of path with the same
 * syntax: its own routes (`/view/data`, `/home/tables`, `/stage/{})`) and the
 * platform's REST services (`/identities/groups`). The first never reaches a
 * server - the browser router answers it - so measuring it here would demand an
 * operation for a page, and a guard full of rows nobody can implement is a guard
 * nobody reads.
 *
 * The list is stated rather than inferred, and it is carried in the committed
 * inventory, so widening it is a diff a reviewer sees. Widening it is how a
 * namespace a previous pass did not consider becomes measured: the alternative -
 * a rule that guesses which first segments look like a platform's - is the sort
 * of inference that hides a missing row.
 *
 * The namespaces are the Viya REST service roots the application declares in its
 * own API map (`client/src/app/services/sas-viya.service.ts`), which is also
 * where its API-explorer page reads them from. The explorer's namespaces are in
 * the list for that reason: the page builds those URLs, so they are the
 * application's platform surface even though no product screen calls them, and
 * `src/viya/appSurface.ts` is where each one is declined with a reason.
 */
export const PLATFORM_ROOTS = [
  'identities',
  'folders',
  'files',
  'compute',
  'jobDefinitions',
  'jobExecution',
  'launchers',
  'types',
  'SASLogon',
  'annotations',
  'authorization',
  'relationships',
  'insights',
  'reports',
  'reportImages',
  'reportTransforms',
  'visualAnalytics',
  'modelManagement',
  'modelRepository',
  'modelPublish',
  'microanalyticScore',
  'dataMining',
  'businessRules',
  'referenceData',
  'treatmentDefinitions',
  'subjectContacts',
  'decisionsRuntimeBuilder',
  'mlPipelineAutomation'
]

/** Whether a normalised path belongs to one of the platform's namespaces. */
export const isPlatformPath = (path, roots = PLATFORM_ROOTS) => {
  const first = path.split('/').filter(Boolean)[0]

  return first !== undefined && roots.includes(first)
}

/** Extensions a source file may have. `.d.ts` is a type, not a call site. */
const isSource = (name) =>
  (name.endsWith('.ts') || name.endsWith('.html')) &&
  !name.endsWith('.spec.ts') &&
  !name.endsWith('.d.ts')

const filesUnder = (directory) =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)

    if (statSync(path).isDirectory())
      return SKIP.has(entry) ? [] : filesUnder(path)

    return isSource(entry) ? [path] : []
  })

/**
 * The inventory: every distinct path the application builds, with the files that
 * name it, so a reader can go and look.
 *
 * The files are what makes a stale row diagnosable: a path no longer named from
 * any source is either a call the application dropped or a measurement that
 * broke, and the two are told apart by opening the file named beside it.
 */
export const extract = (
  sourceDir,
  { root = sourceDir, roots = PLATFORM_ROOTS } = {}
) => {
  const byPath = new Map()

  for (const file of filesUnder(sourceDir)) {
    const where = relative(root, file)

    for (const literal of literalsIn(readFileSync(file, 'utf8'))) {
      if (!isPathLike(literal)) continue

      const path = normalise(literal)

      if (!path || path === '/' || path.startsWith('//')) continue

      // the application's own routes are the router's, not the platform's
      if (!isPlatformPath(path, roots)) continue

      if (!byPath.has(path)) byPath.set(path, new Set())

      byPath.get(path).add(where)
    }
  }

  return Object.fromEntries(
    [...byPath.keys()]
      .sort()
      .map((path) => [path, [...byPath.get(path)].sort()])
  )
}
