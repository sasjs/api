import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SURFACE,
  SURFACE_ADAPTER_VERSION,
  SURFACE_CLI_VERSION
} from '../src/viya/surface.js'

/**
 * The declared surface and the measured ones are the same list.
 *
 * `spec/viya/adapter-paths.json` is what the adapter was measured to call,
 * `spec/viya/cli-paths.json` is what the CLI was, and `src/viya/surface.ts` is
 * what this package has decided about each of those paths. A path in one and not
 * the other is the failure mode the guard exists for in both directions: a call
 * nobody classified is scope creep nobody chose, and a classification for a path
 * the clients no longer build is a stale claim about what a host has to answer.
 *
 * Two clients rather than one because two things drive a deployment: an
 * application ships the adapter, and `sasjs deploy` ships the CLI. The CLI's own
 * literals are few - its commands go through the adapter - but they are the
 * sign-in a deployment does first, so a path it adds is a call the emulator has
 * to answer just as much as an adapter one.
 *
 * `npm run check:scope` closes the third side of the triangle: that the
 * committed inventories still describe the installed adapter and CLI.
 */
const adapterInventory = JSON.parse(
  readFileSync(join(__dirname, 'viya', 'adapter-paths.json'), 'utf8')
)

const cliInventory = JSON.parse(
  readFileSync(join(__dirname, 'viya', 'cli-paths.json'), 'utf8')
)

const measured = Object.keys(adapterInventory.paths).sort()
const measuredCli = Object.keys(cliInventory.paths).sort()
const both = [...new Set([...measured, ...measuredCli])].sort()
const declared = SURFACE.filter((entry) => !entry.source)
  .map((entry) => entry.path)
  .sort()
const captured = SURFACE.filter((entry) => entry.source === 'capture').map(
  (entry) => entry.path
)

describe('the Viya call surface', () => {
  it('declares the adapter version the inventory was measured from', () => {
    expect(SURFACE_ADAPTER_VERSION).toBe(adapterInventory.adapter)
  })

  it('declares the CLI version the inventory was measured from', () => {
    expect(SURFACE_CLI_VERSION).toBe(cliInventory.cli)
  })

  it('classifies every path the adapter builds', () => {
    const unclassified = measured.filter((path) => !declared.includes(path))

    expect(unclassified).toEqual([])
  })

  // The CLI is the half a guard would otherwise miss: its literals live in
  // another package, so nothing that reads only the adapter can see a new one.
  it('classifies every path the CLI builds', () => {
    const unclassified = measuredCli.filter((path) => !declared.includes(path))

    expect(unclassified).toEqual([])
  })

  it('declares nothing neither client builds', () => {
    const imaginary = declared.filter((path) => !both.includes(path))

    expect(imaginary).toEqual([])
  })

  // The CLI's own literals are mostly the adapter's, but not entirely: it signs
  // in against this server's `/SASLogon/authorize`, which the adapter never calls
  // (the adapter's code grant goes to `/SASLogon/oauth/authorize`). Pinned as an
  // equality rather than a subset so both directions are guarded - a CLI path
  // disappeared, or a second one appeared, fails here and names itself.
  it('names the one Viya path the CLI builds and the adapter does not', () => {
    const cliOnly = measuredCli.filter((path) => !measured.includes(path))

    expect(cliOnly).toEqual(['/SASLogon/authorize'])
  })

  it('keeps a captured-only path out of the inventories', () => {
    // a path a capture observed arrives as data - a link in a response - so no
    // extractor over source text can see it. It must not be smuggled into an
    // inventory, and if a client version does build the literal, this fails and
    // the entry loses its `source` instead of drifting.
    const literalNow = captured.filter((path) => both.includes(path))

    expect(literalNow).toEqual([])
  })

  it('states a decision and a reason for every entry', () => {
    for (const entry of SURFACE) {
      expect(['in', 'declined']).toContain(entry.decision)

      // a reason is what a 501 body and a reviewer both read
      expect(entry.reason.length).toBeGreaterThan(20)
    }
  })

  it('declines something, or the guard is only a mirror', () => {
    // if every path were in scope the file would say nothing the inventory does
    // not already say, and a reviewer would have no decisions to check
    expect(SURFACE.some((entry) => entry.decision === 'declined')).toBe(true)
  })

  it('carries the families the emulator is built for', () => {
    for (const family of [
      'viya-auth',
      'viya-identity',
      'viya-folders',
      'viya-files',
      'viya-compute',
      'viya-jobs'
    ])
      expect(SURFACE.some((entry) => entry.family === family)).toBe(true)
  })

  it('keeps the captured families in scope', () => {
    // the six families the recorder has captures for: if one of these is ever
    // declined, the capture and the declaration disagree about the same call
    for (const path of [
      '/identities/users/@currentUser',
      '/SASLogon/oauth/token',
      '/folders/folders',
      '/folders/folders/@item',
      '/folders/folders/@myRecycleBin',
      '/files/files',
      '/types/types',
      '/compute/contexts',
      '/compute/contexts/{}/sessions',
      '/compute/sessions/{}/jobs',
      '/compute/sessions/{}/filerefs/_webout/content'
    ]) {
      const entry = SURFACE.find((candidate) => candidate.path === path)

      expect(entry).toBeTruthy()
      expect(entry!.decision).toBe('in')
    }
  })
})
