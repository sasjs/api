/**
 * Asserts the contents of the tarball `npm publish` would upload.
 *
 * `files` in package.json names `build`, which does not exist in a fresh
 * checkout - npm does not fail on an entry that matches nothing, so a renamed or
 * misspelled path publishes a package that is quietly missing that surface, and
 * the first sign of it is a consumer failing to import, or a mock site whose
 * service worker 404s on `build/browser.js`.
 *
 * What must be in the tarball is derived from the manifest, not listed here a
 * second time: every target named in `exports`, `main`, `module` and `types`, and
 * every entry in `files` that names a file. The one addition is the worker bundle,
 * which no `exports` key can reach because a service worker loads it with
 * `importScripts`, and which the CLI's mock build copies verbatim.
 *
 * The listing is read from the archive rather than from npm's console output:
 * `npm pack --dry-run --json` has been seen to answer an empty array on a
 * runner's npm while the same flags worked locally, and a gate that depends on
 * how a tool formats its output fails for the wrong reason.
 *
 * Requires `tar` on PATH (GNU tar or bsdtar), which the Linux runners carry.
 *
 *     node scripts/check-package.mjs                 # pack, then judge the archive
 *     node scripts/check-package.mjs --list <file>   # judge a saved `tar -tzf` listing
 *
 * Exit 0: the tarball carries every surface the manifest names and no development
 * files. Exit 1: something is missing, leaked, or a `files` entry matched nothing.
 * Exit 2: the check could not run (no tar, pack failed, no listing produced).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A worker loads this with `importScripts`, so no `exports` key can name it. */
const WORKER_BUNDLE = 'build/browser.js'

/** The repository, in the tarball: a published package carries the library only. */
const FORBIDDEN = [
  'src/',
  'spec/',
  'tools/',
  'scripts/',
  'vendor/',
  '.github/',
  '.git-hooks/',
  'node_modules/',
  'jest.config.js',
  'tsconfig.json',
  'tsconfig.base.json',
  'tsconfig.build.cjs.json',
  'tsconfig.build.esm.json',
  'package-lock.json',
  '.prettierrc',
  '.npmrc',
  '.pre-commit-config.yaml'
]

const arg = (name) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

const fail = (code, ...lines) => {
  for (const line of lines) console.error(line)
  process.exit(code)
}

/** `./build/esm/index.js` -> `build/esm/index.js`; `build/` -> `build` */
const normalise = (entry) =>
  String(entry).replace(/^\.\//, '').replace(/\/+$/, '')

/**
 * Everything a consumer can reach, by path in the archive: the manifest's own
 * pointers first, so a target added to `exports` is required without anyone
 * remembering to add it here.
 */
const requiredFrom = (manifest) => {
  const wanted = new Set()
  const add = (value) => {
    if (typeof value === 'string') wanted.add(normalise(value))
  }

  const walk = (exports) => {
    if (typeof exports === 'string') return add(exports)
    if (!exports || typeof exports !== 'object') return
    for (const value of Object.values(exports)) walk(value)
  }

  walk(manifest.exports)
  for (const field of ['main', 'module', 'types']) add(manifest[field])

  // A `files` entry that names a file must be there; an entry that names a
  // directory is required below, as a prefix.
  const named = (manifest.files || []).map(normalise)
  for (const entry of named) if (/\.[a-z0-9]+$/i.test(entry)) wanted.add(entry)

  wanted.add(WORKER_BUNDLE)
  return { wanted: [...wanted].sort(), entries: named }
}

/** The listing as archive-relative paths, without directory entries. */
const entriesOf = (listing) =>
  listing
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalise(line.replace(/^package\//, '')))
    .filter(Boolean)

/**
 * The judgement, kept separate from how the listing was produced so the cases can
 * feed it a fixture instead of packing something.
 */
const judge = (manifest, listing) => {
  const entries = entriesOf(listing)
  const present = new Set(entries)
  const { wanted } = requiredFrom(manifest)

  const missing = wanted.filter((path) => !present.has(path))
  const leaked = entries.filter((entry) =>
    FORBIDDEN.some((bad) =>
      bad.endsWith('/') ? entry.startsWith(bad) : entry === bad
    )
  )

  // A `files` entry that matched nothing is the shape this check exists for:
  // npm stays silent, so nothing else in the pipeline notices.
  const unmatched = (manifest.files || [])
    .map(normalise)
    .filter(
      (entry) =>
        !entries.some((path) => path === entry || path.startsWith(`${entry}/`))
    )

  return { entries, missing, leaked, unmatched }
}

const listingFromArchive = () => {
  if (spawnSync('tar', ['--version'], { stdio: 'ignore' }).status !== 0)
    fail(2, 'check-package could not run: tar is not on PATH')

  const into = mkdtempSync(join(tmpdir(), 'api-pack-'))
  try {
    execFileSync(
      'npm',
      ['pack', '--pack-destination', into, '--ignore-scripts'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe'
      }
    )

    const archive = readdirSync(into).find((name) => name.endsWith('.tgz'))
    if (!archive)
      fail(
        2,
        `check-package could not run: npm pack wrote no archive into ${into}`
      )

    const tar = execFileSync('tar', ['-tzf', join(into, archive)], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
    console.log(`packed ${archive} (${relative(process.cwd(), into) || into})`)
    return tar
  } catch (error) {
    // Any failure here is "the check could not run", whichever exit code the tool
    // it wrapped happened to use - including one that exits 2 of its own. A throw
    // escaping this would report exit 1 with a stack trace, which reads as a
    // failed check rather than a check that never happened.
    fail(
      2,
      `check-package could not run: npm pack failed${
        error?.stderr ? `:\n${String(error.stderr).trim()}` : ''
      }`
    )
  } finally {
    rmSync(into, { recursive: true, force: true })
  }
}

const main = () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const saved = arg('list')

  let listing
  if (saved) {
    try {
      listing = readFileSync(saved, 'utf8')
    } catch (error) {
      fail(
        2,
        `check-package could not run: cannot read ${saved}: ${error.message}`
      )
    }
  } else {
    listing = listingFromArchive()
  }

  const { entries, missing, leaked, unmatched } = judge(manifest, listing)
  const { wanted, entries: named } = requiredFrom(manifest)

  console.log(
    `${entries.length} file(s) in the tarball, ${wanted.length} required, ${named.length} files entr(y/ies) named in the manifest`
  )

  if (missing.length || leaked.length || unmatched.length) {
    for (const path of missing)
      console.log(
        `  MISSING ${path} - named by the manifest or the worker bundle`
      )
    for (const path of leaked)
      console.log(
        `  LEAKED ${path} - repository files do not belong in the package`
      )
    for (const entry of unmatched)
      console.log(
        `  UNMATCHED ${entry} - a files entry that matched nothing in the tarball`
      )
    fail(
      1,
      'the tarball does not carry the package this manifest describes. Fix the paths in package.json, or the build that should have written them.'
    )
  }

  console.log('the tarball carries every surface the manifest names')
}

main()
