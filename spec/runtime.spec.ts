/**
 * The runtime routes, over a runner this file supplies.
 *
 * The corpus pins the statuses; this pins the things a status cannot say - that
 * a trigger's session is readable through the session routes, that two triggers
 * are two sessions, that a run is handed the program and the variables the route
 * named, and that a failing runner is a `400` rather than a `500`.
 */
import { dispatch } from '../src/host/dispatch.js'
import type { Services } from '../src/host/dispatch.js'
import { servicesFor } from '../src/corpus/runner.js'
import type { CorpusCase } from '../src/corpus/drive.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import { DEFAULT_IDENTITY } from '../src/identity/fixture.js'
import {
  createRuntimeService,
  parseDebugValue
} from '../src/runtime/service.js'
import type { RunRequest, SessionRunner } from '../src/runtime/service.js'
import { MemorySessionRunner } from '../src/runtime/memory-runner.js'
import { createSessionService } from '../src/session/service.js'

const ADMIN = { userId: 'user-admin', clientId: 'web_app' }
const RESTRICTED = { userId: 'user-restricted', clientId: 'web_app' }

/** The services the corpus builds for a case that seeds nothing. */
const servicesForCase = (overrides: Partial<CorpusCase> = {}): Services =>
  servicesFor({
    id: 'spec',
    route: 'GET /SASjsApi/stp/execute',
    description: 'spec',
    request: {},
    expect: { status: 200 },
    ...overrides
  })

/** The same services, with the runner the test supplies. */
const withRunner = (runner: SessionRunner): Services => ({
  ...servicesForCase(),
  runtime: createRuntimeService(
    new MemoryIdentityStore(DEFAULT_IDENTITY),
    runner
  )
})

/**
 * A runner that records what it was asked to do.
 *
 * The port's whole purpose is that the package decides and the host performs, so
 * what the host is handed is the contract: this asserts it rather than assuming
 * it.
 */
class RecordingRunner implements SessionRunner {
  readonly requests: RunRequest[] = []

  constructor(
    private readonly outcome: Awaited<ReturnType<SessionRunner['run']>> = {
      output: { contents: 'ran' }
    }
  ) {}

  async run(request: RunRequest) {
    this.requests.push(request)
    return this.outcome
  }
}

describe('a trigger creates a session the session routes can read', () => {
  it('answers an id, and the id names a completed session', async () => {
    const services = servicesForCase()

    const triggered = await dispatch(services, 'POST /SASjsApi/stp/trigger', {
      subject: ADMIN,
      query: { _program: '/Public/apps/demo/run.sas' }
    })

    const sessionId = (triggered.body as { sessionId: string }).sessionId
    expect(sessionId).toMatch(/^\d{14}-\d+-\d+$/)

    const summary = await dispatch(
      services,
      'GET /SASjsApi/session/{sessionId}',
      { subject: ADMIN, params: { sessionId } }
    )

    expect(summary.status).toBe(200)
    // a memory runner finishes before it answers, and it has no process to name
    expect(summary.body).toMatchObject({ sessionId, state: 'completed' })
    expect((summary.body as { pid?: number }).pid).toBeUndefined()

    const state = await dispatch(
      services,
      'GET /SASjsApi/session/{sessionId}/state',
      { subject: ADMIN, params: { sessionId } }
    )
    expect(state.body).toEqual({ state: 'completed' })
  })

  it('makes two triggers two sessions', async () => {
    const services = servicesForCase()

    const first = await dispatch(services, 'POST /SASjsApi/stp/trigger', {
      subject: ADMIN,
      query: { _program: '/Public/apps/demo/run.sas' }
    })
    const second = await dispatch(services, 'POST /SASjsApi/stp/trigger', {
      subject: ADMIN,
      query: { _program: '/Public/apps/demo/run.sas' }
    })

    const idOf = (body: unknown) => (body as { sessionId: string }).sessionId
    expect(idOf(first.body)).not.toBe(idOf(second.body))

    // both readable: two triggers must not share one record, which is what a
    // colliding id would do
    for (const response of [first, second]) {
      const summary = await dispatch(
        services,
        'GET /SASjsApi/session/{sessionId}',
        { subject: ADMIN, params: { sessionId: idOf(response.body) } }
      )
      expect(summary.status).toBe(200)
    }
  })

  it('records the caller as the owner, and a foreign session is still a 404', async () => {
    const identity = new MemoryIdentityStore({
      ...DEFAULT_IDENTITY,
      users: [
        ...DEFAULT_IDENTITY.users,
        {
          uid: 'user-other',
          username: 'other',
          displayName: 'Other',
          password: 'secret123',
          isAdmin: false,
          isActive: true,
          needsToUpdatePassword: false
        }
      ]
    })
    const runner = new MemorySessionRunner()
    const services: Services = {
      ...servicesForCase(),
      identity: undefined,
      records: undefined,
      runtime: createRuntimeService(identity, runner),
      session: createSessionService(identity, runner)
    }

    const triggered = await dispatch(services, 'POST /SASjsApi/stp/trigger', {
      subject: RESTRICTED,
      query: { _program: '/Public/apps/demo/run.sas' }
    })
    const sessionId = (triggered.body as { sessionId: string }).sessionId

    const asOwner = await dispatch(
      services,
      'GET /SASjsApi/session/{sessionId}',
      { subject: RESTRICTED, params: { sessionId } }
    )
    expect(asOwner.status).toBe(200)
    expect(await runner.session(sessionId)).toMatchObject({
      owner: 'user-restricted'
    })

    const asAdmin = await dispatch(
      services,
      'GET /SASjsApi/session/{sessionId}',
      { subject: ADMIN, params: { sessionId } }
    )
    expect(asAdmin.status).toBe(200)

    // a refusal travels as a thrown ApiError, which a host renders as its
    // status: the same answer a stranger receives is a 404, not a 403
    const asStranger = await dispatch(
      services,
      'GET /SASjsApi/session/{sessionId}',
      {
        subject: { userId: 'user-other', clientId: 'web_app' },
        params: { sessionId }
      }
    ).catch((error) => error)
    expect(asStranger.status).toBe(404)
  })

  it('records the retention the caller asked for', async () => {
    const services = servicesForCase()

    const triggered = await dispatch(services, 'POST /SASjsApi/stp/trigger', {
      subject: ADMIN,
      query: { _program: '/Public/apps/demo/run.sas', expiresAfterMins: '15' }
    })
    const sessionId = (triggered.body as { sessionId: string }).sessionId

    const summary = await dispatch(
      services,
      'GET /SASjsApi/session/{sessionId}',
      { subject: ADMIN, params: { sessionId } }
    )
    expect(summary.body).toMatchObject({
      expiresAfterMins: { mins: 15, used: false }
    })
  })
})

describe('what the package hands the runner', () => {
  it('names a stored program by its drive path', async () => {
    const runner = new RecordingRunner()
    const services = withRunner(runner)

    await dispatch(services, 'GET /SASjsApi/stp/execute', {
      subject: ADMIN,
      query: { _program: '/Public/apps/demo/run.sas', _debug: '131' }
    })

    expect(runner.requests).toHaveLength(1)
    expect(runner.requests[0].program).toEqual({
      path: '/Public/apps/demo/run.sas'
    })
    // the stored-program routes pass the request's own parameters through, so a
    // caller's `_debug` is the value the program sees
    // `_debug` is normalised here, not passed through: a keyword means the log,
    // integer text is a level, and a host handed '131' as text would fail the
    // macros' numeric comparison and answer without a log
    expect(runner.requests[0].vars).toMatchObject({ _debug: 131 })
    // an execute waits for the program, so there is no session to record
    expect(runner.requests[0].session).toBeUndefined()
  })

  it('names a code request by its source, and asks for the log', async () => {
    const runner = new RecordingRunner()
    const services = withRunner(runner)

    await dispatch(services, 'POST /SASjsApi/code/execute', {
      subject: ADMIN,
      body: { code: 'data _null_; run;', runTime: 'sas' }
    })

    expect(runner.requests[0].program).toEqual({
      code: 'data _null_; run;'
    })
    // the documented response body is assembled from the webout, the log and the
    // listing, so the code routes force the log on
    expect(runner.requests[0].vars).toMatchObject({ _debug: 131 })
  })

  it('passes the session a trigger created, owned by the caller uid', async () => {
    const runner = new RecordingRunner()
    const services = withRunner(runner)

    await dispatch(services, 'POST /SASjsApi/code/trigger', {
      subject: RESTRICTED,
      body: { code: 'data _null_; run;', runTime: 'js', expiresAfterMins: 5 }
    })

    expect(runner.requests[0].session).toMatchObject({
      owner: 'user-restricted',
      runTime: 'js',
      expiresAfterMins: 5
    })
    expect(runner.requests[0].session?.sessionId).toMatch(/^\d{14}-\d+-\d+$/)
  })

  it('refuses a program path that leaves the drive, before the runner sees it', async () => {
    const runner = new RecordingRunner()
    const services = withRunner(runner)

    const response = await dispatch(services, 'GET /SASjsApi/stp/execute', {
      subject: ADMIN,
      query: { _program: '../../etc/passwd' }
    }).catch((error) => error)

    // the same 400 a program that is not there answers: whether the path was
    // rejected or merely absent is the host's filesystem, and not the caller's
    // business
    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      status: 'failure',
      message: 'Job execution failed.',
      error: 'The Program at (../../etc/passwd) does not exist.'
    })
    expect(runner.requests).toEqual([])
  })

  it('resolves a relative program path against the drive root', async () => {
    const runner = new RecordingRunner()
    const services = withRunner(runner)

    await dispatch(services, 'GET /SASjsApi/stp/execute', {
      subject: ADMIN,
      query: { _program: 'Public/apps/./demo//run.sas' }
    })

    expect(runner.requests[0].program).toEqual({
      path: '/Public/apps/demo/run.sas'
    })
  })

  it("takes the run time from a stored program's extension", async () => {
    const runner = new RecordingRunner()
    await dispatch(withRunner(runner), 'GET /SASjsApi/stp/execute', {
      subject: ADMIN,
      query: { _program: '/Public/apps/demo/run.js' }
    })

    expect(runner.requests[0].program).toEqual({
      path: '/Public/apps/demo/run.js'
    })
    // the server reads the extension before it looks for the file, which is a
    // decision about the request and not about the filesystem
    expect(runner.requests[0].runTime).toBe('js')
  })

  it('leaves the run time and the file to the host when the path names neither', async () => {
    const runner = new RecordingRunner()
    await dispatch(withRunner(runner), 'GET /SASjsApi/stp/execute', {
      subject: ADMIN,
      query: { _program: '/Public/apps/demo/run' }
    })

    // the form every document example uses: the server probes `<path>.<runTime>`
    // for each run time it holds, and only a host has a filesystem to probe
    expect(runner.requests[0].program).toEqual({
      path: '/Public/apps/demo/run'
    })
    expect(runner.requests[0].runTime).toBeUndefined()
  })

  it('hands uploaded files to the runner by field name', async () => {
    const runner = new RecordingRunner()
    const services = withRunner(runner)

    await dispatch(services, 'POST /SASjsApi/stp/execute', {
      subject: ADMIN,
      query: { _program: '/Public/apps/demo/run.sas' },
      files: [{ name: 'dataset.csv', contents: 'a,b\n1,2\n' }]
    })

    expect(runner.requests[0].files).toEqual({ 'dataset.csv': 'a,b\n1,2\n' })
  })
})

describe('`_debug` is normalised, as the server normalises it', () => {
  const varsFor = async (query: Record<string, string>) => {
    const runner = new RecordingRunner()
    await dispatch(withRunner(runner), 'GET /SASjsApi/stp/execute', {
      subject: ADMIN,
      query: { _program: '/Public/apps/demo/run.sas', ...query }
    })
    return runner.requests[0].vars
  }

  it('reads a keyword as "return the log"', async () => {
    expect((await varsFor({ _debug: 'log' }))._debug).toBe(131)
    expect((await varsFor({ _debug: 'LOG' }))._debug).toBe(131)
  })

  it('reads integer text as the level it names', async () => {
    expect((await varsFor({ _debug: '131' }))._debug).toBe(131)
    expect((await varsFor({ _debug: '17' }))._debug).toBe(17)
  })

  it('leaves a number alone, and reports an absent one as absent', async () => {
    const absent = await varsFor({})
    // not merely undefined: a host that walks the entries to build a query
    // string must not emit `_debug=undefined` for a caller who never asked
    expect('_debug' in absent).toBe(false)
    expect((await varsFor({ _debug: '' }))._debug).toBeUndefined()
    expect(parseDebugValue(17)).toBe(17)
    // not a level: `Number()` would read these as 1000 and 16
    expect(parseDebugValue('1e3')).toBe(131)
    expect(parseDebugValue('0x10')).toBe(131)
  })
})

describe('what a run answers', () => {
  it('hands a text output on as it came', async () => {
    const services = servicesForCase({
      request: {
        subject: ADMIN,
        query: { _program: '/Public/apps/demo/run.sas' }
      },
      runOutput: { contents: 'hello' }
    })

    const response = await dispatch(services, 'GET /SASjsApi/stp/execute', {
      subject: ADMIN,
      query: { _program: '/Public/apps/demo/run.sas' }
    })

    expect(response.status).toBe(200)
    expect(response.contents).toBe('hello')
  })

  it('does not validate a retention on an execute, which never uses one', async () => {
    // the query schema for these routes tolerates extra parameters, so a
    // retention in the query is a session variable - and the server answers 200
    const services = servicesForCase({
      request: {
        subject: ADMIN,
        query: { _program: '/Public/apps/demo/run.sas' }
      },
      runOutput: { contents: 'ok' }
    })

    const response = await dispatch(services, 'GET /SASjsApi/stp/execute', {
      subject: ADMIN,
      query: {
        _program: '/Public/apps/demo/run.sas',
        expiresAfterMins: '0'
      }
    })

    expect(response.status).toBe(200)
    expect(response.contents).toBe('ok')
  })

  it('answers an empty body for a program that wrote nothing', async () => {
    const services = servicesForCase()

    const response = await dispatch(services, 'POST /SASjsApi/code/execute', {
      subject: ADMIN,
      body: { code: 'data _null_; run;', runTime: 'sas' }
    })

    expect(response.contents).toBe('')
  })

  it("answers a failing run as a 400 with the server's body, not a 500", async () => {
    const services = servicesForCase({ failingRun: true })

    const response = await dispatch(services, 'POST /SASjsApi/code/execute', {
      subject: ADMIN,
      body: { code: 'data _null_; run;', runTime: 'sas' }
    }).catch((error) => error)

    // the dispatcher throws an ApiError; a host renders its body and its status
    expect(response.status).toBe(400)
    expect(response.message).toBe('Job execution failed.')
    expect(response.body).toEqual({
      status: 'failure',
      message: 'Job execution failed.',
      error: 'Error: the mock run failed'
    })
  })

  it('reports a pid only when the host has one', async () => {
    const runner = new MemorySessionRunner({ pid: 4242 })
    const identity = new MemoryIdentityStore(DEFAULT_IDENTITY)
    const services: Services = {
      ...servicesForCase(),
      runtime: createRuntimeService(identity, runner),
      session: createSessionService(identity, runner)
    }

    const triggered = await dispatch(services, 'POST /SASjsApi/stp/trigger', {
      subject: ADMIN,
      query: { _program: '/Public/apps/demo/run.sas' }
    })

    expect(triggered.body).toEqual({
      sessionId: expect.stringMatching(/^\d{14}-\d+-\d+$/),
      pid: 4242
    })
  })
})

describe('the refusals only the service can answer', () => {
  it('answers 501 for a run route when the host supplies no runner', async () => {
    const services = { ...servicesForCase(), runtime: undefined }

    const response = await dispatch(services, 'POST /SASjsApi/stp/trigger', {
      subject: ADMIN,
      query: { _program: '/Public/apps/demo/run.sas' }
    }).catch((error) => error)

    expect(response.status).toBe(501)
    expect(response.message).toBe(
      'This host has no runtime service, so it cannot answer POST /SASjsApi/stp/trigger.'
    )
  })

  it("refuses a run time outside the host's own list, defaulting to the document's", async () => {
    const identity = new MemoryIdentityStore(DEFAULT_IDENTITY)
    const onlyJs = createRuntimeService(identity, new MemorySessionRunner(), {
      runTimes: ['js']
    })

    await expect(
      onlyJs.execute(ADMIN, { source: 'code', code: 'x', runTime: 'sas' })
    ).rejects.toMatchObject({
      status: 400,
      message: '"runTime" must be one of [js]'
    })

    // the default is the five the document names, so a package with no host
    // option is not silently narrower than the contract
    const defaults = createRuntimeService(identity, new MemorySessionRunner())
    await expect(
      defaults.execute(ADMIN, { source: 'code', code: 'x', runTime: 'sasviya' })
    ).resolves.toBeDefined()
  })

  it('names the parameter its own route declared, when one is missing', async () => {
    const runtime = createRuntimeService(
      new MemoryIdentityStore(DEFAULT_IDENTITY),
      new MemorySessionRunner()
    )

    // a code route never had a `_program`, so refusing one by that name would
    // send a client looking for a field the document does not give it
    await expect(
      runtime.execute(ADMIN, { source: 'code' })
    ).rejects.toMatchObject({ status: 400, message: '"code" is required' })

    await expect(
      runtime.trigger(ADMIN, { source: 'code', code: 'x' })
    ).rejects.toMatchObject({ status: 400, message: '"runTime" is required' })

    await expect(
      runtime.execute(ADMIN, { source: 'program' })
    ).rejects.toMatchObject({ status: 400, message: '"_program" is required' })

    // and a stored program's run time is the host's to resolve, so its absence
    // is not a refusal
    await expect(
      runtime.execute(ADMIN, { source: 'program', program: '/x.sas' })
    ).resolves.toBeDefined()
  })

  it('refuses a deactivated account and an absent caller alike', async () => {
    const identity = new MemoryIdentityStore({
      ...DEFAULT_IDENTITY,
      users: DEFAULT_IDENTITY.users.map((user) =>
        user.uid === 'user-restricted' ? { ...user, isActive: false } : user
      )
    })
    const runtime = createRuntimeService(identity, new MemorySessionRunner())

    await expect(
      runtime.execute(RESTRICTED, { source: 'code', code: 'x', runTime: 'sas' })
    ).rejects.toMatchObject({ status: 401, message: 'Unauthorized' })

    await expect(
      runtime.execute(undefined, { source: 'code', code: 'x', runTime: 'sas' })
    ).rejects.toMatchObject({ status: 401, message: 'Unauthorized' })
  })
})
