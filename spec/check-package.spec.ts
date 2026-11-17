import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * `files` names `build`, which a fresh checkout does not have, and npm does not
 * fail on an entry that matches nothing - so a renamed path publishes a package
 * quietly missing that surface. This is the gate that fails instead; it runs
 * after `npm run build`, as `npm run check:package`.
 *
 * The cases judge a saved `tar -tzf` listing (`--list`), so they pin the
 * decisions without packing anything. The listing that should pass is derived
 * from the manifest: a target added to `exports` is covered by these cases
 * without anyone editing them.
 */
const manifest = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
)

/** Every path in the archive a consumer can reach, from the manifest's pointers. */
const reachable = (): string[] => {
  const paths = new Set<string>()
  const walk = (value: unknown) => {
    if (typeof value === 'string') paths.add(value.replace(/^\.\//, ''))
    else if (value && typeof value === 'object')
      for (const inner of Object.values(value)) walk(inner)
  }
  walk(manifest.exports)
  for (const field of ['main', 'module', 'types'])
    if (manifest[field]) paths.add(String(manifest[field]).replace(/^\.\//, ''))
  for (const entry of manifest.files || [])
    if (/\.[a-z0-9]+$/i.test(entry)) paths.add(entry)
  // a worker loads this with importScripts, so no exports key names it
  paths.add('build/browser.js')
  return [...paths]
}

const run = (
  listing: string | undefined
): { status: number; output: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'check-package-'))
  const args = ['scripts/check-package.mjs']

  if (listing !== undefined) {
    const path = join(dir, 'listing.txt')
    writeFileSync(path, listing)
    args.push('--list', path)
  } else {
    args.push('--list', join(dir, 'absent.txt'))
  }

  try {
    const output = execFileSync(process.execPath, args, { encoding: 'utf8' })
    return { status: 0, output }
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string }
    return {
      status: failure.status,
      output: `${failure.stdout}${failure.stderr}`
    }
  }
}

/** An archive that carries exactly the reachable paths, plus its own manifest. */
const goodListing = (): string =>
  [
    'package/package.json',
    ...reachable().map((path) => `package/${path}`)
  ].join('\n')

describe('the package contents gate', () => {
  it('passes when the tarball carries every surface the manifest names', () => {
    const { status, output } = run(goodListing())

    expect(status).toBe(0)
    expect(output).toContain(
      'the tarball carries every surface the manifest names'
    )
  })

  it('fails when a path the manifest names is not in the tarball', () => {
    // the renamed-build case: `files` says build, the archive has nothing under it
    const listing = reachable()
      .filter((path) => !path.startsWith('build/'))
      .map((path) => `package/${path}`)
      .join('\n')

    const { status, output } = run(listing)

    expect(status).toBe(1)
    expect(output).toContain('MISSING build/browser.js')
    expect(output).toContain(
      'UNMATCHED build - a files entry that matched nothing'
    )
  })

  it('fails when a repository file leaks into the tarball', () => {
    const { status, output } = run(`${goodListing()}\npackage/src/index.ts`)

    expect(status).toBe(1)
    expect(output).toContain('LEAKED src/index.ts')
  })

  it('requires the worker bundle, which no exports key names', () => {
    // a service worker loads build/browser.js with importScripts, so it is
    // reachable at runtime and invisible to the manifest's own pointers
    const listing = [
      'package/package.json',
      'package/README.md',
      'package/LICENCE.md'
    ]
      .concat(
        reachable()
          .filter(
            (path) =>
              path !== 'build/browser.js' &&
              !path.endsWith('.md') &&
              !path.endsWith('LICENCE.md')
          )
          .filter((path) => /\.[a-z0-9]+$/i.test(path))
          .map((path) => `package/${path}`)
      )
      .join('\n')

    const { status, output } = run(listing)

    expect(status).toBe(1)
    expect(output).toContain('MISSING build/browser.js')
  })
})

describe('the package contents gate, when it cannot run', () => {
  it('fails rather than passing on a listing it could not read', () => {
    const { status, output } = run(undefined)

    expect(status).toBe(2)
    expect(output).toContain('check-package could not run')
    expect(output).toContain('absent.txt')
  })
})
