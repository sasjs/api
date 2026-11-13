/**
 * The code service, on its own entry point.
 *
 * `@sasjs/lint` reads the filesystem (its config resolution walks up for a
 * `.sasjslint`), so it cannot be bundled for a service worker: the package root
 * stays free of it and a host that wants these routes imports `@sasjs/api/code`.
 */

export { createCodeService } from './service.js'
export type { CodeRequest, CodeService, CodeServiceOptions } from './service.js'

/**
 * The configuration class the service hands the linter.
 *
 * A host that resolves rules from its own storage parses a `.sasjslint` and has
 * to build the configuration the routes expect. Exporting the class here lets
 * it build that with the linter this package bundles, instead of adding
 * `@sasjs/lint` to its own dependencies and carrying a second copy to keep in
 * step. What keeps the two in step is this package's exact dependency pin, not
 * the export: a host that installs the linter itself still resolves whatever
 * its own tree gives it.
 */
export { LintConfig } from '@sasjs/lint'
