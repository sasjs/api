import { ROUTES, routeById } from '../src/routes/index.js'
import { CODE_CORPUS } from '../src/corpus/code.js'
import { INFO_CORPUS } from '../src/corpus/info.js'
import { DRIVE_CORPUS } from '../src/corpus/drive.js'
import { DEPLOY_CORPUS } from '../src/corpus/deploy.js'
import { IDENTITY_CORPUS } from '../src/corpus/identity.js'
import { RECORD_CORPUS } from '../src/corpus/records.js'
import { SESSION_CORPUS } from '../src/corpus/session.js'
import { RUNTIME_CORPUS } from '../src/corpus/runtime.js'

/**
 * The document says what a host may answer; the corpus is what a host is shown
 * to answer. The drift ratchet in routes.spec.ts compares the table with the
 * document, which catches a status the overlay invents - but on its own it
 * cannot catch a documented status nothing can send, because the document is
 * where both sides of that comparison come from.
 *
 * This is the other direction, and it uses the corpus rather than another list:
 * every status the document states for an implemented route must be exercised by
 * a case, and every status a case expects must be stated by the document. A
 * status added to the document with no case fails here; a case answering a
 * status the document does not state fails here too.
 */
const corpusByRoute = () => {
  const byRoute = new Map<string, Set<number>>()

  for (const testCase of [
    ...DRIVE_CORPUS,
    ...DEPLOY_CORPUS,
    ...CODE_CORPUS,
    ...INFO_CORPUS,
    ...IDENTITY_CORPUS,
    ...RECORD_CORPUS,
    ...SESSION_CORPUS,
    ...RUNTIME_CORPUS
  ]) {
    const seen = byRoute.get(testCase.route) || new Set<number>()
    seen.add(testCase.expect.status)
    byRoute.set(testCase.route, seen)
  }

  return byRoute
}

describe('the document and the corpus agree, in both directions', () => {
  const cases = corpusByRoute()
  const implemented = ROUTES.filter((route) => route.implemented)

  it('has a case for every implemented route, so nothing is unchecked', () => {
    const unchecked = implemented
      .filter((route) => !cases.has(route.id))
      .map((route) => route.id)

    expect(unchecked).toEqual([])
  })

  it("states exactly the statuses its cases answer, apart from the host's own", () => {
    // a status the overlay marks host-only is answered before the package is
    // consulted - a lockout, a provider failure, a session-store failure - and
    // is pinned by that host's suite rather than by this corpus
    const drift = implemented
      .map((route) => {
        const documented = (routeById(route.id)?.responses || [])
          .map((response) => response.status)
          .filter((status) => !(route.hostResponses || []).includes(status))
          .sort((a, b) => a - b)
        const answered = [...(cases.get(route.id) || [])].sort((a, b) => a - b)

        return { id: route.id, documented, answered }
      })
      .filter(
        ({ documented, answered }) =>
          JSON.stringify(documented) !== JSON.stringify(answered)
      )

    expect(drift).toEqual([])
  })
})
