/**
 * The corpus, run against this package's own services.
 *
 * These are the assertions the browser build and the server will run too - the
 * point of keeping them as data. A failure here is either a service that
 * disagrees with sasjs/server or a case that names the wrong behaviour, and both
 * are worth stopping on.
 */
import { CODE_CORPUS } from '../src/corpus/code.js'
import { createCodeService } from '../src/code/service.js'
import { DRIVE_CORPUS } from '../src/corpus/drive.js'
import { DEPLOY_CORPUS } from '../src/corpus/deploy.js'
import { IDENTITY_CORPUS } from '../src/corpus/identity.js'
import { RECORD_CORPUS } from '../src/corpus/records.js'
import { SESSION_CORPUS } from '../src/corpus/session.js'
import { RUNTIME_CORPUS } from '../src/corpus/runtime.js'
import { runCase, servicesFor } from '../src/corpus/runner.js'
import type { CorpusCase } from '../src/corpus/drive.js'

const CORPORA: Array<[string, CorpusCase[]]> = [
  ['drive corpus', DRIVE_CORPUS],
  ['deploy corpus', DEPLOY_CORPUS],
  ['code corpus', CODE_CORPUS],
  ['identity corpus', IDENTITY_CORPUS],
  ['record corpus', RECORD_CORPUS],
  ['session corpus', SESSION_CORPUS],
  ['runtime corpus', RUNTIME_CORPUS]
]

describe.each(CORPORA)('%s', (_name, corpus) => {
  for (const testCase of corpus) {
    it(`${testCase.id}: ${testCase.description}`, async () => {
      const actual = await runCase(
        testCase,
        // the code service is not part of the browser-safe core, so a host (and
        // this suite) supplies it
        { ...servicesFor(testCase), code: createCodeService() }
      )

      expect({ case: testCase.id, status: actual.status }).toEqual({
        case: testCase.id,
        status: testCase.expect.status
      })

      if (testCase.expect.error !== undefined)
        expect({ case: testCase.id, error: actual.error }).toEqual({
          case: testCase.id,
          error: testCase.expect.error
        })

      if (testCase.expect.body !== undefined)
        expect(actual.body).toEqual(testCase.expect.body)

      if (testCase.expect.contents !== undefined)
        expect(actual.contents).toEqual(testCase.expect.contents)

      if (testCase.expect.partial !== undefined)
        expect(actual.body).toMatchObject(testCase.expect.partial)

      if (testCase.expect.keys !== undefined)
        expect(Object.keys(actual.body as object).sort()).toEqual(
          testCase.expect.keys.slice().sort()
        )
    })
  }
})

describe('corpus coverage', () => {
  it('has a case for every operation this package implements', async () => {
    // an operation with no case is an operation nobody proved anything about
    const covered = new Set(
      CORPORA.flatMap(([, corpus]) => corpus.map((testCase) => testCase.route))
    )
    const { ROUTES } = await import('../src/routes/index.js')

    const implemented = ROUTES.filter((route) => route.implemented).map(
      (route) => route.id
    )
    expect(implemented.filter((id) => !covered.has(id))).toEqual([])
  })
})
