/**
 * Generate the Viya table and corpus from the captures in the recorder's folder.
 *
 * `npm run sync:viya` writes, `npm run check:viya` compares. The check needs the
 * captures, which are never committed - an operator's run lives on their machine
 * and describes their estate - so CI runs the spec instead: it holds the
 * committed files against `src/viya/surface.ts` and the pinned version, which is
 * what can be verified anywhere.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import prettier from 'prettier'
import {
  mergeOperations,
  operationsOf,
  renderCorpus,
  renderTable
} from '../tools/viya-capture/generate.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const captureArg = process.argv.indexOf('--capture')
const captureDir =
  captureArg > -1
    ? process.argv[captureArg + 1]
    : join(root, 'tools/viya-capture/capture')
const tablePath = join(root, 'src/viya/table.ts')
const corpusPath = join(root, 'src/corpus/viya/operations.ts')
const check = process.argv.includes('--check')

// the pin lives in a TypeScript module, and a generator that imported it would
// need the build; reading one constant out of it keeps the pin in one place
const version = readFileSync(join(root, 'src/viya/version.ts'), 'utf8').match(
  /VIYA_TARGET_VERSION = '([^']+)'/
)?.[1]

if (!version) {
  console.error('src/viya/version.ts states no VIYA_TARGET_VERSION')
  process.exit(2)
}

let files

try {
  files = readdirSync(captureDir).filter((file) => file.endsWith('.json'))
} catch {
  files = []
}

if (!files.length) {
  console.error(
    `No captures in ${captureDir}.\n` +
      'The table describes what an estate answered, so there is nothing to ' +
      'generate without one. Run the recorder against an estate, or read the ' +
      'committed table as the record of the last capture.'
  )
  process.exit(2)
}

const operations = mergeOperations(
  files
    .sort()
    .map((file) =>
      operationsOf(JSON.parse(readFileSync(join(captureDir, file), 'utf8')))
    )
)

// the repository's own prettier config, the way sync-routes formats the route
// table: a generator with its own style fails the Formatting step
const format = async (source, path) =>
  prettier.format(source, {
    ...((await prettier.resolveConfig(path)) || {}),
    parser: 'typescript'
  })

const table = await format(renderTable(operations, version), tablePath)
const corpus = await format(renderCorpus(operations, version), corpusPath)

const write = (path, contents) => {
  if (check) {
    const committed = readFileSync(path, 'utf8')

    if (committed !== contents) {
      console.error(
        `${path} does not match what the captures produce. Run \`npm run sync:viya\` and review the diff.`
      )
      process.exitCode = 1
    }

    return
  }

  writeFileSync(path, contents, 'utf8')
}

write(tablePath, table)
write(corpusPath, corpus)

if (!process.exitCode)
  console.log(
    `${check ? 'checked' : 'wrote'} ${operations.length} operations from ${files.length} capture(s), Viya ${version}`
  )
