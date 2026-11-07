/**
 * The code service, on its own entry point.
 *
 * `@sasjs/lint` reads the filesystem (its config resolution walks up for a
 * `.sasjslint`), so it cannot be bundled for a service worker: the package root
 * stays free of it and a host that wants these routes imports `@sasjs/api/code`.
 */
export { createCodeService } from './service.js'
export type { CodeRequest, CodeService, CodeServiceOptions } from './service.js'
