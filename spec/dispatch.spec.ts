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
  it('answers 501 for an operation this package has no handler for, naming it and what it waits on', async () => {
    // The reason comes from src/routes/overlay.ts, so the refusal says what the
    // operation depends on rather than only that it is missing.
    expect(
      await failure(() => dispatch(services(), 'GET /SASjsApi/info'))
    ).toEqual({
      status: 501,
      message:
        "This package has no handler for GET /SASjsApi/info. The body is the host's own configuration - ports, run times and providers - which a mock states for itself and this package cannot know."
    })
  })

  it('names a reason for every operation it refuses', async () => {
    // covered in spec/routes.spec.ts against the table; this is the transport
    // half - the reason reaches the caller rather than staying in the source. A
    // body is supplied so the required-parameter check does not answer first.
    const message = (
      (await failure(() =>
        dispatch(services(), 'POST /SASjsApi/code/lint', {
          body: { code: 'data _null_; run;' }
        })
      )) as { message: string }
    ).message

    expect(message).toContain('@sasjs/lint')
  })

  it('answers 501 for a record route when the host supplies no record service', async () => {
    // the services are optional: a host that has a drive but no identity records
    // answers these routes the same way it answers one this package never wrote,
    // and the message says which dependency is missing rather than "no handler"
    expect(
      await failure(() => dispatch(services(), 'GET /SASjsApi/user'))
    ).toEqual({
      status: 501,
      message:
        'This host has no record service, so it cannot answer GET /SASjsApi/user.'
    })
  })

  it('answers 501 for a sign-in route when the host supplies no identity service', async () => {
    expect(
      await failure(() =>
        dispatch(services(), 'POST /SASLogon/login', {
          body: { username: 'admin', password: 'admin123' }
        })
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no identity service, so it cannot answer POST /SASLogon/login.'
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
