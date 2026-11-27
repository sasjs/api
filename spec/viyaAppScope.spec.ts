import { readFileSync } from 'fs'
import { join } from 'path'
import { APP_SURFACE, APP_SURFACE_APPLICATION } from '../src/viya/appSurface.js'
import { VIYA_OPERATIONS } from '../src/viya/declared.js'

/**
 * The application's declared surface and its measured inventory are one list.
 *
 * `spec/viya/app-paths.json` is what Data Controller's client was measured to
 * build (`npm run check:app-scope` re-runs the extraction against a checkout),
 * and `src/viya/appSurface.ts` is what this package has decided about each of
 * those paths. A path in one and not the other is the failure mode the guard
 * exists for in both directions: a call nobody classified is a screen that
 * answers 404 on an emulated estate, and a classification for a path the
 * application no longer builds is a stale claim about what a host must answer.
 *
 * The third side of the triangle - that the committed inventory still describes
 * the application - is `npm run check:app-scope`, which needs a checkout and so
 * cannot run here.
 */
const inventory = JSON.parse(
  readFileSync(join(__dirname, 'viya', 'app-paths.json'), 'utf8')
)

const measured: string[] = Object.keys(inventory.paths).sort()
const declared = APP_SURFACE.map((entry) => entry.path).sort()

const segments = (path: string) => path.split('/')

/**
 * Whether a declared path covers an operation path.
 *
 * The same rule `spec/viyaTable.spec.ts` applies to the adapter's surface: a
 * client states a path at the granularity it builds, and a path that ends at an
 * identifier is a prefix the client appends to - `/identities/users/{}` followed
 * by `/memberships`. Keeping the two implementations separate is deliberate: the
 * application's fragments concatenate in their own way, and a shared helper would
 * make one client's measurement hide the other's gap.
 */
const covers = (declaredPath: string, operationPath: string) => {
  const left = segments(declaredPath)
  const right = segments(operationPath)

  if (left.length > right.length) return false

  const prefixAllowed = left[left.length - 1] === '{}'

  if (!prefixAllowed && left.length !== right.length) return false

  return left.every(
    (segment, index) =>
      segment === right[index] || segment === '{}' || right[index] === '{}'
  )
}

/**
 * Paths a host answers itself rather than the emulator.
 *
 * The auth flow is the case: the host that mounts the emulator owns the token
 * port, which is why `POST /SASLogon/oauth/token` is declined in the overlay with
 * that reason. Everything else in scope has to be an operation.
 */
const HOST_ANSWERED = ['/SASLogon']

describe('the application call surface', () => {
  it('classifies every path the application builds', () => {
    const unclassified = measured.filter((path) => !declared.includes(path))

    expect(unclassified).toEqual([])
  })

  it('declares nothing the application does not build', () => {
    const imaginary = declared.filter((path) => !measured.includes(path))

    expect(imaginary).toEqual([])
  })

  it('names the application the inventory was measured from', () => {
    expect(inventory.application).toBe(APP_SURFACE_APPLICATION.name)
    expect(inventory.repository).toBe(APP_SURFACE_APPLICATION.repository)
    expect(inventory.measuredFrom).toBe(APP_SURFACE_APPLICATION.measuredFrom)
  })

  it('states a decision and a reason for every entry', () => {
    for (const entry of APP_SURFACE) {
      expect(['in', 'declined']).toContain(entry.decision)

      // a reason is what a reviewer reads and, for a declined path, what the
      // next person to ask "why is this 404" is owed
      expect(entry.reason.length).toBeGreaterThan(20)
    }
  })

  it('declines something, or the guard is only a mirror', () => {
    expect(APP_SURFACE.some((entry) => entry.decision === 'declined')).toBe(
      true
    )
  })

  it('answers every in-scope path with an operation, or states that a host does', () => {
    // the gap this file exists for: a path declared in scope that no operation
    // answers is a screen that fails on an emulated estate, and the table spec
    // alone cannot see it - that check runs from operations to scope, not back
    const unanswered = APP_SURFACE.filter((entry) => entry.decision === 'in')
      .map((entry) => entry.path)
      .filter((path) => !HOST_ANSWERED.includes(path))
      .filter(
        (path) =>
          !VIYA_OPERATIONS.some((operation) => covers(path, operation.path))
      )

    expect(unanswered).toEqual([])
  })

  it('states the namespaces it measured, and only measures those', () => {
    expect(inventory.roots.length).toBeGreaterThan(0)

    const outside = measured.filter(
      (path) => !inventory.roots.includes(path.split('/').filter(Boolean)[0])
    )

    expect(outside).toEqual([])
  })

  it('names a file for every measured path, so a stale row is diagnosable', () => {
    for (const [path, files] of Object.entries(
      inventory.paths as Record<string, string[]>
    )) {
      expect(`${path}: ${files.length > 0}`).toBe(`${path}: true`)
    }
  })
})
