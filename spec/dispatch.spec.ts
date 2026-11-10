/**
 * The dispatcher's own edges: the answers that are about the API rather than
 * about the drive.
 */
import { dispatch, noHandler } from '../src/host/dispatch.js'
import { createRecordService } from '../src/identity/records.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import { DEFAULT_IDENTITY } from '../src/identity/fixture.js'
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

/** The shape a host without a sign-in flow supplies: records, nothing else. */
const recordsOnly = (): ReturnType<typeof createRecordService> =>
  createRecordService(new MemoryIdentityStore({ ...DEFAULT_IDENTITY }))

describe('dispatch', () => {
  it('refuses an operation the table states but no case answers', () => {
    // unreachable while every operation has a handler; exported so the safety
    // net is itself tested rather than trusted
    const error = noHandler('GET /SASjsApi/nope')

    expect({ status: error.status, message: error.message }).toEqual({
      status: 501,
      message: 'This package has no handler for GET /SASjsApi/nope.'
    })
  })

  it('answers 404 for an operation the API does not have', async () => {
    // every operation in the table has a handler now, so the refusal a caller
    // can still reach is a path that is not in the document at all
    expect(
      await failure(() => dispatch(services(), 'GET /SASjsApi/nope'))
    ).toEqual({ status: 404, message: 'No such operation: GET /SASjsApi/nope' })
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

  it('answers 501 for a session route when the host supplies no session service', async () => {
    // same rule as the records above: the four session routes need something the
    // package cannot invent - the run time that holds the sessions - and the
    // message names it rather than reporting "no handler"
    expect(
      await failure(() =>
        dispatch(services(), 'GET /SASjsApi/session/{sessionId}', {
          params: { sessionId: 'sess-admin' }
        })
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no session service, so it cannot answer GET /SASjsApi/session/{sessionId}.'
    })
  })

  it('answers 501 for an unpublish when the host has no app stream', async () => {
    expect(
      await failure(() =>
        dispatch(services(), 'DELETE /SASjsApi/drive/deploy', {
          body: { appLoc: '/Public/myApp', streamServiceName: 'myApp' }
        })
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no app stream, so it cannot answer DELETE /SASjsApi/drive/deploy.'
    })
  })

  it('answers 501 on a record route when it has records but no identity service', async () => {
    // a records-only host can answer, but only for a caller it resolved itself:
    // without a subject there is nothing to authenticate, and a 401 would put a
    // host without a sign-in flow into a login loop
    expect(
      await failure(() =>
        dispatch(
          { ...services(), records: recordsOnly() },
          'GET /SASjsApi/user'
        )
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no identity service, so it cannot answer GET /SASjsApi/user.'
    })
  })

  it('serves a record route for a caller the host resolved itself', async () => {
    const answer = await dispatch(
      { ...services(), records: recordsOnly() },
      'GET /SASjsApi/user',
      {
        subject: { userId: 'user-admin', clientId: 'web_app' }
      }
    )

    expect(answer.status).toBe(200)
  })

  it('answers 501 for a sign-in route when the host supplies no identity service', async () => {
    expect(
      await failure(() =>
        dispatch(services(), 'POST /SASLogon/login', {
          body: { username: 'sasjsadmin', password: 'Orion123' }
        })
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no identity service, so it cannot answer POST /SASLogon/login.'
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
