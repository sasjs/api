/**
 * The session routes' conformance corpus.
 *
 * Every status the document states for these four routes has a case, in both
 * directions - that is what `spec/corpus-parity.spec.ts` enforces. The refusals
 * arrived here only after sasjs/server#574 documented them: until then the
 * package answered a 401 and a 404 that the document did not state, and a case
 * pinning one would have been called drift.
 *
 * `404` covers an unknown session and someone else's alike, on purpose - the id
 * is guessable within a window, so confirming that it exists would say the id
 * was right. The cases below keep the two apart so a change that starts
 * answering `403` for a foreign session is visible.
 */
import type { CorpusCase } from './drive.js'

const ADMIN = { userId: 'user-admin', clientId: 'web_app' }
const RESTRICTED = { userId: 'user-restricted', clientId: 'web_app' }

const notFound = (id: string) => `Session with ID '${id}' was not found.`
const UNAUTHORIZED = 'Unauthorized'

export const SESSION_CORPUS: CorpusCase[] = [
  // ---------------------------------------------------------------- summary
  {
    id: 'session-summary-own',
    route: 'GET /SASjsApi/session/{sessionId}',
    description: 'answers the owner the summary of their own session',
    request: { subject: ADMIN, params: { sessionId: 'sess-admin' } },
    expect: {
      status: 200,
      body: {
        sessionId: 'sess-admin',
        state: 'completed',
        pid: 4242,
        creationTimeStamp: '2026-11-07T09:00:00.000Z',
        deathTimeStamp: '2026-11-07T09:00:04.000Z',
        expiresAfterMins: { mins: 60, used: false }
      }
    }
  },
  {
    id: 'session-summary-as-admin',
    route: 'GET /SASjsApi/session/{sessionId}',
    description: "answers an administrator another account's session",
    request: { subject: ADMIN, params: { sessionId: 'sess-restricted' } },
    // both stamps: the document requires them, and this host stamps a session's
    // death time at creation rather than at completion - a running session
    // answers with the moment it is due to be destroyed
    expect: {
      status: 200,
      body: {
        sessionId: 'sess-restricted',
        state: 'running',
        pid: 4243,
        creationTimeStamp: '2026-11-07T09:05:00.000Z',
        deathTimeStamp: '2026-11-07T09:20:00.000Z'
      }
    }
  },
  {
    id: 'session-summary-unauthenticated',
    route: 'GET /SASjsApi/session/{sessionId}',
    description: 'refuses a caller with no token',
    request: { params: { sessionId: 'sess-admin' } },
    expect: { status: 401, error: UNAUTHORIZED }
  },
  {
    id: 'session-summary-foreign',
    route: 'GET /SASjsApi/session/{sessionId}',
    description: "answers 404 for another account's session, not 403",
    request: { subject: RESTRICTED, params: { sessionId: 'sess-admin' } },
    expect: { status: 404, error: notFound('sess-admin') }
  },
  {
    id: 'session-summary-unknown',
    route: 'GET /SASjsApi/session/{sessionId}',
    description: 'answers the same 404 for a session that does not exist',
    request: { subject: ADMIN, params: { sessionId: 'sess-nope' } },
    expect: { status: 404, error: notFound('sess-nope') }
  },

  // -------------------------------------------------------------------- log
  {
    id: 'session-log-own',
    route: 'GET /SASjsApi/session/{sessionId}/log',
    description: 'answers the log this session wrote',
    request: { subject: ADMIN, params: { sessionId: 'sess-admin' } },
    expect: {
      status: 200,
      contents: 'NOTE: session started\nNOTE: session completed\n'
    }
  },
  {
    id: 'session-log-nothing-written',
    route: 'GET /SASjsApi/session/{sessionId}/log',
    description: 'answers an empty body for a session that has written nothing',
    request: { subject: ADMIN, params: { sessionId: 'sess-silent' } },
    expect: { status: 200, contents: '' }
  },
  {
    id: 'session-log-unauthenticated',
    route: 'GET /SASjsApi/session/{sessionId}/log',
    description: 'refuses a caller with no token',
    request: { params: { sessionId: 'sess-admin' } },
    expect: { status: 401, error: UNAUTHORIZED }
  },
  {
    id: 'session-log-foreign',
    route: 'GET /SASjsApi/session/{sessionId}/log',
    description: "will not read another account's log",
    request: { subject: RESTRICTED, params: { sessionId: 'sess-admin' } },
    expect: { status: 404, error: notFound('sess-admin') }
  },

  // ----------------------------------------------------------------- output
  {
    id: 'session-output-own',
    route: 'GET /SASjsApi/session/{sessionId}/output',
    description: 'answers the webout this session produced',
    request: { subject: ADMIN, params: { sessionId: 'sess-admin' } },
    expect: { status: 200, contents: '<html><body>42</body></html>' }
  },
  {
    id: 'session-output-unauthenticated',
    route: 'GET /SASjsApi/session/{sessionId}/output',
    description: 'refuses a caller with no token',
    request: { params: { sessionId: 'sess-admin' } },
    expect: { status: 401, error: UNAUTHORIZED }
  },
  {
    id: 'session-output-foreign',
    route: 'GET /SASjsApi/session/{sessionId}/output',
    description: "will not read another account's webout",
    request: { subject: RESTRICTED, params: { sessionId: 'sess-admin' } },
    expect: { status: 404, error: notFound('sess-admin') }
  },

  // ------------------------------------------------------------------ state
  {
    id: 'session-state-own',
    route: 'GET /SASjsApi/session/{sessionId}/state',
    description: "answers the run time's state for this session",
    request: { subject: RESTRICTED, params: { sessionId: 'sess-restricted' } },
    // the state alone: the document's SessionStateResponse permits no other
    // property, and `sasjs/server` answers exactly this object
    expect: { status: 200, body: { state: 'running' } }
  },
  {
    id: 'session-state-unauthenticated',
    route: 'GET /SASjsApi/session/{sessionId}/state',
    description: 'refuses a caller with no token',
    request: { params: { sessionId: 'sess-restricted' } },
    expect: { status: 401, error: UNAUTHORIZED }
  },
  {
    id: 'session-state-foreign',
    route: 'GET /SASjsApi/session/{sessionId}/state',
    description: "will not report another account's session state",
    request: { subject: RESTRICTED, params: { sessionId: 'sess-admin' } },
    expect: { status: 404, error: notFound('sess-admin') }
  }
]
