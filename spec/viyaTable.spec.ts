import { SURFACE } from '../src/viya/surface.js'
import { UNRECORDED } from '../src/viya/unrecorded.js'
import { VIYA_TABLE } from '../src/viya/table.js'
import { VIYA_CORPUS } from '../src/corpus/viya/operations.js'
import {
  EMULATED_HEADER,
  EMULATED_HEADER_VALUE,
  VIYA_CAPTURED_AT,
  VIYA_TARGET_VERSION,
  emulatedHeaders
} from '../src/viya/version.js'

/**
 * The table, the corpus and the surface describe one thing.
 *
 * Phase 0's exit criteria, as assertions: every operation carries a captured
 * case or a stated reason, the table and the scope decision agree, and the
 * pinned version appears in the answers. The captures themselves are never
 * committed - they describe someone's estate - so this is what can be verified
 * anywhere, and `npm run check:viya` is the extra check an operator can run
 * where the captures live.
 */
const segments = (path: string) => path.split('/')

/**
 * Whether a declared surface path covers an operation path.
 *
 * Prefix, segment by segment, with `{}` matching a segment either way. The
 * surface is stated at the granularity the client builds: it names
 * `/files/files/{}` while the capture observed `/files/files/{}/content`,
 * because the client appends `/content` to a URI it already holds.
 */
const covers = (surfacePath: string, operationPath: string) => {
  const declared = segments(surfacePath)
  const operation = segments(operationPath)

  if (declared.length > operation.length) return false

  return declared.every(
    (segment, index) =>
      segment === operation[index] ||
      segment === '{}' ||
      operation[index] === '{}'
  )
}

const inScope = SURFACE.filter((entry) => entry.decision === 'in')

describe('the Viya table', () => {
  it('holds an operation only where the scope says a host must answer it', () => {
    const outside = VIYA_TABLE.filter(
      (operation) =>
        !inScope.some((entry) => covers(entry.path, operation.path))
    ).map((operation) => operation.id)

    expect(outside).toEqual([])
  })

  it('accounts for every in-scope path: captured, or a stated reason', () => {
    const recorded = (path: string) =>
      VIYA_TABLE.some((operation) => covers(path, operation.path))

    const missing = inScope
      .map((entry) => entry.path)
      .filter(
        (path) =>
          !recorded(path) && !UNRECORDED.some((entry) => entry.path === path)
      )

    expect(missing).toEqual([])
  })

  it('does not list an unrecorded path that a capture describes', () => {
    const stale = UNRECORDED.filter((entry) =>
      VIYA_TABLE.some((operation) => covers(entry.path, operation.path))
    ).map((entry) => entry.path)

    expect(stale).toEqual([])
  })

  it('states a reason with every unrecorded operation', () => {
    for (const entry of UNRECORDED)
      expect(entry.reason.length).toBeGreaterThan(30)
  })

  it('gives every operation at least one observed status', () => {
    for (const operation of VIYA_TABLE) {
      expect(operation.id).toBe(`${operation.method} ${operation.path}`)
      expect(operation.statuses.length).toBeGreaterThan(0)
    }
  })

  it('carries a case for every operation, and no case for anything else', () => {
    const routes = VIYA_TABLE.map((operation) => operation.id).sort()
    const cases = VIYA_CORPUS.map((entry) => entry.route).sort()

    expect(cases).toEqual(routes)
  })

  it('pins the status the capture saw, inside the statuses the operation declares', () => {
    for (const entry of VIYA_CORPUS)
      expect(entry.statuses).toContain(entry.expected)
  })
})

describe('the pinned version', () => {
  it('names the version and the day it was captured', () => {
    expect(VIYA_TARGET_VERSION).toMatch(/^V\.\d{2}\.\d{2}/)
    expect(VIYA_CAPTURED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('stamps one header, with the pin in it', () => {
    expect(EMULATED_HEADER_VALUE).toBe(`viya@${VIYA_TARGET_VERSION}`)
    expect(emulatedHeaders()[EMULATED_HEADER]).toBe(EMULATED_HEADER_VALUE)
  })

  it('exposes the header to a browser reading the answer across an origin', () => {
    // without this the one header that makes emulation unmistakable is the one a
    // cross-origin client cannot read
    expect(emulatedHeaders()['Access-Control-Expose-Headers']).toBe(
      EMULATED_HEADER
    )
  })
})

describe('what the generated files may carry', () => {
  // the emulator generates its data from a seed; a value that came from an
  // estate is a value that belongs to that estate
  const generated = () =>
    [VIYA_TABLE, VIYA_CORPUS, UNRECORDED]
      .map((value) => JSON.stringify(value))
      .join('\n')

  it('carries no identifier that came from an estate', () => {
    expect(generated()).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    )
  })

  it('carries no filesystem path and no host', () => {
    expect(generated()).not.toMatch(/\/Users\//)
    expect(generated()).not.toMatch(/https?:\/\//)
  })
})
