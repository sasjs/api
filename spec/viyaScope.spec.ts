import { readFileSync } from 'fs'
import { join } from 'path'
import { SURFACE, SURFACE_ADAPTER_VERSION } from '../src/viya/surface.js'

/**
 * The declared surface and the measured one are the same list.
 *
 * `spec/viya/adapter-paths.json` is what the adapter was measured to call, and
 * `src/viya/surface.ts` is what this package has decided about each of those
 * paths. A path in one and not the other is the failure mode the guard exists
 * for in both directions: a call nobody classified is scope creep nobody chose,
 * and a classification for a path the client no longer builds is a stale claim
 * about what a host has to answer.
 *
 * `npm run check:scope` closes the third side of the triangle: that the
 * committed inventory still describes the installed adapter.
 */
const inventory = JSON.parse(
  readFileSync(join(__dirname, 'viya', 'adapter-paths.json'), 'utf8')
)

const measured = Object.keys(inventory.paths).sort()
const declared = SURFACE.map((entry) => entry.path).sort()

describe('the Viya call surface', () => {
  it('declares the adapter version the inventory was measured from', () => {
    expect(SURFACE_ADAPTER_VERSION).toBe(inventory.adapter)
  })

  it('classifies every path the adapter builds', () => {
    const unclassified = measured.filter((path) => !declared.includes(path))

    expect(unclassified).toEqual([])
  })

  it('declares nothing the adapter does not build', () => {
    const imaginary = declared.filter((path) => !measured.includes(path))

    expect(imaginary).toEqual([])
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
