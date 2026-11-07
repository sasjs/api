/**
 * The runtime routes' conformance corpus.
 *
 * Every status the document states for these five routes has a case, in both
 * directions - that is what `spec/corpus-parity.spec.ts` enforces. The refusals
 * arrived here only after sasjs/server#584 documented them: until then the
 * document stated `200` alone, and a case pinning the `400` or the `401` would
 * have been called drift.
 *
 * What a *program* does is not part of this contract. The output a case pins is
 * the output its runner was told to produce, so the same cases hold for a host
 * with a SAS binary and for a mock with nothing but maps - which is the point of
 * the runner being a port.
 */
import type { CorpusCase } from './drive.js'

const ADMIN = { userId: 'user-admin', clientId: 'web_app' }

const PROGRAM = '/Public/apps/demo/run.sas'
const CODE = 'data _null_;\n  put "hello";\nrun;'

const UNAUTHORIZED = 'Unauthorized'
const FAILED = 'Job execution failed.'

/** Bytes without an encoding API, as the drive corpus has them. */
const bytes = (...values: number[]) => Uint8Array.from(values)

export const RUNTIME_CORPUS: CorpusCase[] = [
  // ------------------------------------------------- GET /stp/execute
  {
    id: 'stp-execute-get-answers-output',
    route: 'GET /SASjsApi/stp/execute',
    description: 'answers the output the program produced',
    request: { subject: ADMIN, query: { _program: PROGRAM } },
    runOutput: { contents: 'hello from the program' },
    expect: { status: 200, contents: 'hello from the program' }
  },
  {
    id: 'stp-execute-get-answers-bytes',
    route: 'GET /SASjsApi/stp/execute',
    description: 'answers an output that is bytes as bytes',
    request: { subject: ADMIN, query: { _program: PROGRAM } },
    runOutput: { contents: bytes(1, 2, 3) },
    expect: { status: 200, contents: bytes(1, 2, 3) }
  },
  {
    id: 'stp-execute-get-missing-program',
    route: 'GET /SASjsApi/stp/execute',
    description: 'refuses a request that names no program',
    request: { subject: ADMIN, query: {} },
    expect: { status: 400, error: '"_program" is required' }
  },
  {
    id: 'stp-execute-get-failed-run',
    route: 'GET /SASjsApi/stp/execute',
    description: 'answers 400 when the program could not be run',
    request: { subject: ADMIN, query: { _program: PROGRAM } },
    failingRun: true,
    expect: { status: 400, error: FAILED }
  },
  {
    id: 'stp-execute-get-unauthenticated',
    route: 'GET /SASjsApi/stp/execute',
    description: 'refuses a caller with no token',
    request: { query: { _program: PROGRAM } },
    expect: { status: 401, error: UNAUTHORIZED }
  },

  // ------------------------------------------------ POST /stp/execute
  {
    id: 'stp-execute-post-body-program',
    route: 'POST /SASjsApi/stp/execute',
    description: 'runs the program the body names',
    request: { subject: ADMIN, body: { _program: PROGRAM } },
    runOutput: { contents: 'hello from the body' },
    expect: { status: 200, contents: 'hello from the body' }
  },
  {
    id: 'stp-execute-post-query-program',
    route: 'POST /SASjsApi/stp/execute',
    description: 'runs the program the query names, with no body',
    request: { subject: ADMIN, query: { _program: PROGRAM }, body: {} },
    runOutput: { contents: 'hello from the query' },
    expect: { status: 200, contents: 'hello from the query' }
  },
  {
    id: 'stp-execute-post-no-program',
    route: 'POST /SASjsApi/stp/execute',
    description: 'refuses a request with no program in the query or the body',
    request: { subject: ADMIN, body: {} },
    expect: { status: 400, error: '"_program" is required' }
  },
  {
    id: 'stp-execute-post-failed-run',
    route: 'POST /SASjsApi/stp/execute',
    description: 'answers 400 when the program could not be run',
    request: { subject: ADMIN, body: { _program: PROGRAM } },
    failingRun: true,
    expect: { status: 400, error: FAILED }
  },
  {
    id: 'stp-execute-post-unauthenticated',
    route: 'POST /SASjsApi/stp/execute',
    description: 'refuses a caller with no token, before it reads the payload',
    request: { body: {} },
    expect: { status: 401, error: UNAUTHORIZED }
  },

  // ------------------------------------------------ POST /stp/trigger
  {
    id: 'stp-trigger-answers-session',
    route: 'POST /SASjsApi/stp/trigger',
    description: 'answers the session a caller polls, and no pid from a mock',
    request: { subject: ADMIN, query: { _program: PROGRAM } },
    expect: { status: 200, keys: ['sessionId'] }
  },
  {
    id: 'stp-trigger-retention',
    route: 'POST /SASjsApi/stp/trigger',
    description: 'accepts a retention in minutes, as the query carries it',
    request: {
      subject: ADMIN,
      query: { _program: PROGRAM, expiresAfterMins: '15' }
    },
    expect: { status: 200, keys: ['sessionId'] }
  },
  {
    id: 'stp-trigger-retention-not-positive',
    route: 'POST /SASjsApi/stp/trigger',
    description: 'refuses a retention that is not a positive number of minutes',
    request: {
      subject: ADMIN,
      query: { _program: PROGRAM, expiresAfterMins: '0' }
    },
    expect: { status: 400, error: '"expiresAfterMins" must be greater than 0' }
  },
  {
    id: 'stp-trigger-missing-program',
    route: 'POST /SASjsApi/stp/trigger',
    description: 'refuses a request that names no program',
    request: { subject: ADMIN, query: {} },
    expect: { status: 400, error: '"_program" is required' }
  },
  {
    id: 'stp-trigger-failed-run',
    route: 'POST /SASjsApi/stp/trigger',
    description: 'answers 400 when the program could not be started',
    request: { subject: ADMIN, query: { _program: PROGRAM } },
    failingRun: true,
    expect: { status: 400, error: FAILED }
  },
  {
    id: 'stp-trigger-unauthenticated',
    route: 'POST /SASjsApi/stp/trigger',
    description: 'refuses a caller with no token',
    request: { query: { _program: PROGRAM } },
    expect: { status: 401, error: UNAUTHORIZED }
  },

  // ----------------------------------------------- POST /code/execute
  {
    id: 'code-execute-answers-output',
    route: 'POST /SASjsApi/code/execute',
    description: 'runs the code in the body and answers its output',
    request: { subject: ADMIN, body: { code: CODE, runTime: 'sas' } },
    runOutput: { contents: 'NOTE: mock run' },
    expect: { status: 200, contents: 'NOTE: mock run' }
  },
  {
    // The refusal's *message* is not pinned here: it names the run times the
    // host holds, which is deployment data - `r` is a valid request where R is
    // configured and a 400 where it is not - so a corpus that stated a list
    // would be asserting one host's install. `spec/runtime.spec.ts` pins the
    // wording against an explicit list; this states the status every host sends
    // for a name no host holds.
    id: 'code-execute-unknown-runtime',
    route: 'POST /SASjsApi/code/execute',
    description: 'refuses a run time the document does not name',
    request: { subject: ADMIN, body: { code: CODE, runTime: 'cobol' } },
    expect: { status: 400 }
  },
  {
    id: 'code-execute-missing-code',
    route: 'POST /SASjsApi/code/execute',
    description: 'refuses a payload with no code',
    request: { subject: ADMIN, body: { runTime: 'sas' } },
    expect: { status: 400, error: '"code" is required' }
  },
  {
    id: 'code-execute-empty-code',
    route: 'POST /SASjsApi/code/execute',
    description: 'refuses code that is present but empty',
    request: { subject: ADMIN, body: { code: '', runTime: 'sas' } },
    expect: { status: 400, error: '"code" is not allowed to be empty' }
  },
  {
    id: 'code-execute-non-string-code',
    route: 'POST /SASjsApi/code/execute',
    description:
      'refuses code that is not a string rather than running its text',
    request: { subject: ADMIN, body: { code: 123, runTime: 'sas' } },
    expect: { status: 400, error: '"code" must be a string' }
  },
  {
    id: 'code-execute-failed-run',
    route: 'POST /SASjsApi/code/execute',
    description: 'answers 400 when the code could not be run',
    request: { subject: ADMIN, body: { code: CODE, runTime: 'sas' } },
    failingRun: true,
    expect: { status: 400, error: FAILED }
  },
  {
    id: 'code-execute-unauthenticated',
    route: 'POST /SASjsApi/code/execute',
    description: 'refuses a caller with no token, before it reads the payload',
    request: { body: {} },
    expect: { status: 401, error: UNAUTHORIZED }
  },

  // ----------------------------------------------- POST /code/trigger
  {
    id: 'code-trigger-answers-session',
    route: 'POST /SASjsApi/code/trigger',
    description: 'answers the session a caller polls, and no pid from a mock',
    request: { subject: ADMIN, body: { code: CODE, runTime: 'sas' } },
    expect: { status: 200, keys: ['sessionId'] }
  },
  {
    id: 'code-trigger-missing-runtime',
    route: 'POST /SASjsApi/code/trigger',
    description:
      'refuses a payload with no run time, which the document requires',
    request: { subject: ADMIN, body: { code: CODE } },
    expect: { status: 400, error: '"runTime" is required' }
  },
  {
    id: 'code-trigger-retention-not-positive',
    route: 'POST /SASjsApi/code/trigger',
    description: 'refuses a retention that is not a positive number of minutes',
    request: {
      subject: ADMIN,
      body: { code: CODE, runTime: 'sas', expiresAfterMins: 0 }
    },
    expect: { status: 400, error: '"expiresAfterMins" must be greater than 0' }
  },
  {
    id: 'code-trigger-failed-run',
    route: 'POST /SASjsApi/code/trigger',
    description: 'answers 400 when the code could not be started',
    request: { subject: ADMIN, body: { code: CODE, runTime: 'sas' } },
    failingRun: true,
    expect: { status: 400, error: FAILED }
  },
  {
    id: 'code-trigger-unauthenticated',
    route: 'POST /SASjsApi/code/trigger',
    description: 'refuses a caller with no token',
    request: { body: { code: CODE, runTime: 'sas' } },
    expect: { status: 401, error: UNAUTHORIZED }
  }
]
