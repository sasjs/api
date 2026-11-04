/**
 * The corpus, run against this package's own services.
 *
 * These are the assertions the browser build and the server will run too - the
 * point of keeping them as data. A failure here is either a service that
 * disagrees with sasjs/server or a case that names the wrong behaviour, and both
 * are worth stopping on.
 */
import { DRIVE_CORPUS } from '../src/corpus/drive.js'
import { runCase } from '../src/corpus/runner.js'

describe('drive corpus', () => {
  for (const testCase of DRIVE_CORPUS) {
    it(`${testCase.id}: ${testCase.description}`, async () => {
      const actual = await runCase(testCase)

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
    })
  }

  it('has a case for every operation this package implements', async () => {
    // an operation with no case is an operation nobody proved anything about
    const covered = new Set(DRIVE_CORPUS.map((testCase) => testCase.route))
    const { ROUTES } = await import('../src/routes/index.js')

    const implemented = ROUTES.filter((route) => route.implemented).map(
      (route) => route.id
    )
    expect(implemented.filter((id) => !covered.has(id))).toEqual([])
  })
})
