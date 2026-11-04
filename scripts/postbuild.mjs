/**
 * Two things the compilers cannot do themselves.
 *
 * 1. The ESM output is `.js` files whose `import` statements node will only run
 *    as ES modules if the nearest package.json says so - hence the one line
 *    written into build/esm. Without it node reads them as CommonJS and fails on
 *    the first `export`.
 * 2. The CJS output needs no such marker, but the package root must not claim
 *    `"type": "module"`, or the require side breaks instead.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

mkdirSync(join(root, 'build', 'esm'), { recursive: true })
writeFileSync(
  join(root, 'build', 'esm', 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2) + '\n'
)
