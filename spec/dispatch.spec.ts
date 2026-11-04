/**
 * The dispatcher's own edges: the answers that are about the API rather than
 * about the drive.
 */
import { dispatch } from '../src/host/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { isApiError } from '../src/types.js'
import { runCase, servicesFor } from '../src/corpus/runner.js'
import type { CorpusCase } from '../src/corpus/drive.js'

const services = () => ({ drive: createDriveService(new MemoryDriveStore()) })

const failure = async (run: () => Promise<unknown>) => {
  try {
    await run()
    return 'resolved'
  } catch (error) {
    return isApiError(error)
      ? { status: error.status, message: error.message }
      : String(error)
  }
}

describe('dispatch', () => {
  it('answers 501 for an operation this package has no handler for, naming it', async () => {
    expect(
      await failure(() => dispatch(services(), 'GET /SASjsApi/info'))
    ).toEqual({
      status: 501,
      message: 'This package has no handler for GET /SASjsApi/info.'
    })
  })

  it('answers 404 for an operation the API does not have', async () => {
    expect(
      await failure(() => dispatch(services(), 'GET /SASjsApi/nope'))
    ).toEqual({
      status: 404,
      message: 'No such operation: GET /SASjsApi/nope'
    })
  })

  it('validates a required parameter before the handler runs', async () => {
    // the table says newPath is required, so the handler never sees the request
    expect(
      await failure(() =>
        dispatch(services(), 'POST /SASjsApi/drive/rename', {
          body: { oldPath: '/a' }
        })
      )
    ).toEqual({ status: 400, message: '"newPath" is required' })
  })
})

describe('corpus runner', () => {
  it('lets an error that is not an API refusal through, rather than reporting it as a status', async () => {
    // a store that breaks is a bug in the host, not a decision the API made;
    // turning it into a 500 here would hide it from the suite
    const testCase: CorpusCase = {
      id: 'broken-store',
      route: 'GET /SASjsApi/drive/folder',
      description: 'a store that throws',
      request: {},
      expect: { status: 200 }
    }
    const broken = {
      ...servicesFor(testCase).drive,
      list: () => {
        throw new Error('store is broken')
      }
    }

    await expect(runCase(testCase, { drive: broken })).rejects.toThrow(
      'store is broken'
    )
  })
})
