/**
 * Regenerate the client inventories, or check that they still match the clients.
 *
 * The house pattern (`scripts/sync-routes.mjs`): `npm run sync:scope` writes,
 * `npm run check:scope` is the CI guard and exits non-zero when a committed
 * inventory and the installed client disagree.
 *
 * Scope decision 3 of sasjs/server#665 is the adapter's call surface - and, since
 * the CLI is the other client a deployment is driven from, the CLI's own literals
 * on top of it. Both are measured here rather than asserted in a document: the
 * adapter is an HTTP client whose literals are nearly all calls, so it is read
 * whole; the CLI is not, so it is read through the same instrument and kept to
 * the Viya prefixes the emulator is built for, with everything set aside counted
 * and recorded.
 *
 * Both clients are read from the capture tool's tree, because that tool pins the
 * versions - one pin, three consumers (the recorder, this check and the spec)
 * rather than a second dependency in this package.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extract,
  extractViya,
  VIYA_PREFIXES
} from '../tools/viya-capture/surface.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tools = join(root, 'tools/viya-capture/node_modules/@sasjs')
const check = process.argv.includes('--check')

const require = createRequire(import.meta.url)

/**
 * What each client is read with, and where its inventory lives.
 *
 * `read` differs because the clients differ: the adapter is measured whole, the
 * CLI through the prefix filter with its discard count recorded, and with its own
 * test files skipped - a fixture in a spec is not a call, and a CLI test that
 * grew one would otherwise redden this package.
 */
const CLIENTS = [
  {
    name: 'adapter',
    dir: join(tools, 'adapter'),
    out: join(root, 'spec/viya/adapter-paths.json'),
    read: (dir) => ({ kept: extract(dir), dropped: [] })
  },
  {
    name: 'cli',
    dir: join(tools, 'cli'),
    out: join(root, 'spec/viya/cli-paths.json'),
    read: (dir) => extractViya(dir, { skip: ['assets', 'spec'] }),
    recordsPrefixes: true
  }
]

/** The version of a client, or a message naming what to install. */
const versionOf = ({ name, dir }) => {
  try {
    return require(join(dir, 'package.json')).version
  } catch {
    console.error(
      `@sasjs/${name} is not installed at ${dir}.\n` +
        'Run `npm ci --prefix tools/viya-capture`, then try again - the ' +
        'inventory is measured from the client, so there is nothing to compare ' +
        'without it.'
    )
    process.exit(2)
  }
}

/**
 * Why two inventories disagree, computed rather than assumed.
 *
 * A guard's message is read by whoever has to fix it, so it states what it found:
 * the version each side was measured from, and the paths added, removed or moved
 * to another file. Naming a cause nobody checked - "the literals live elsewhere"
 * for a version bump - is the failure this shape avoids.
 */
const differences = (before, after) => {
  const added = Object.keys(after).filter((path) => !(path in before))
  const removed = Object.keys(before).filter((path) => !(path in after))
  const moved = Object.keys(before).filter(
    (path) =>
      path in after &&
      JSON.stringify(before[path]) !== JSON.stringify(after[path])
  )

  return { added, removed, moved }
}

let failed = false

for (const client of CLIENTS) {
  const version = versionOf(client)
  const { kept, dropped } = client.read(client.dir)

  const inventory = {
    [client.name]: version,
    extractedFrom: `node_modules/@sasjs/${client.name}`
  }

  // Only the CLI is filtered, and its inventory states the filter whether or not
  // this build happens to discard anything: keyed off the count, an inventory
  // whose literals all fell inside the prefixes would claim no filter was applied,
  // and the count that shows the filter still matches the build would stop being
  // checked.
  if (client.recordsPrefixes) {
    inventory.prefixes = VIYA_PREFIXES
    inventory.dropped = dropped
  }

  inventory.paths = kept

  const rendered = JSON.stringify(inventory, null, 2) + '\n'

  if (!check) {
    writeFileSync(client.out, rendered, 'utf8')
    console.log(
      `wrote ${client.out}: ${Object.keys(kept).length} paths from ` +
        `@sasjs/${client.name} ${version}` +
        (dropped.length
          ? ` (${dropped.length} literals outside the Viya prefixes)`
          : '')
    )
    continue
  }

  let committed
  let raw

  try {
    raw = readFileSync(client.out, 'utf8')
    committed = JSON.parse(raw)
  } catch {
    console.error(
      `No inventory at ${client.out}. Run \`npm run sync:scope\` and commit it.`
    )
    failed = true
    continue
  }

  const { added, removed, moved } = differences(committed.paths, kept)
  const causes = []

  if (committed[client.name] !== version)
    causes.push(`the inventory was measured from ${committed[client.name]}`)

  if (added.length) causes.push(`the client now names: ${added.join(', ')}`)

  if (removed.length)
    causes.push(`the client no longer names: ${removed.join(', ')}`)

  if (moved.length)
    causes.push(
      `the same paths are now named from other files: ${moved.join(', ')}`
    )

  // What the filter set aside, by name. A count alone moves and has to be
  // noticed; a path that appears here is a line in a diff - which is what a call
  // that lands outside the prefixes becomes, and the one case worth catching.
  if (client.recordsPrefixes) {
    const before = committed.dropped ?? []
    const nowAside = dropped.filter((path) => !before.includes(path))
    const noLonger = before.filter((path) => !dropped.includes(path))

    if (nowAside.length)
      causes.push(`the filter now sets aside: ${nowAside.join(', ')}`)

    if (noLonger.length)
      causes.push(`the filter no longer sets aside: ${noLonger.join(', ')}`)
  }

  // The record of HOW the inventory was read, not only what it found. A prefix
  // added to `VIYA_PREFIXES` that changes no kept path would otherwise pass while
  // the inventory still documented the old filter - the same drift the discard
  // count exists to catch, one field over.
  if (committed.extractedFrom !== inventory.extractedFrom)
    causes.push(
      `the inventory records its source as ${committed.extractedFrom}, ` +
        `where this read is ${inventory.extractedFrom}`
    )

  if (
    JSON.stringify(committed.prefixes ?? []) !==
    JSON.stringify(inventory.prefixes ?? [])
  )
    causes.push(
      `the inventory records the filter [${(committed.prefixes ?? []).join(', ')}], ` +
        `where this read applied [${(inventory.prefixes ?? []).join(', ')}]`
    )

  // Each field is compared above, so a difference none of them named means this
  // check has a gap - a failure, not a match. Without it, a blind spot would be
  // reported as a clean run.
  if (!causes.length && raw !== rendered)
    causes.push(
      'the committed inventory differs in a way this check cannot name'
    )

  if (!causes.length) {
    console.log(
      `the inventory matches @sasjs/${client.name} ${version}: ` +
        `${Object.keys(kept).length} paths`
    )
    continue
  }

  failed = true

  console.error(
    `The committed inventory does not describe @sasjs/${client.name} ` +
      `${version}:\n  ` +
      causes.join('\n  ') +
      '\nRun `npm run sync:scope`, then decide each new path in ' +
      'src/viya/surface.ts - a path a client calls and this package has not ' +
      'classified is scope creep that nobody chose.'
  )
}

process.exit(failed ? 1 : 0)
