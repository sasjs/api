/**
 * The session routes' conformance corpus.
 *
 * Only the `200` answers are here, and that is a statement about the document
 * rather than about the routes: sasjs/server documents these four with a `200`
 * and nothing else, so `spec/corpus-parity.spec.ts` refuses a case that pins a
 * refusal. Their `401` and the `404` that covers both "no such session" and
 * "not yours" are pinned in `spec/session.spec.ts` instead, which the parity
 * gate does not govern.
 *
 * The routes are in `documentRefusals.baseline.json` upstream; when they carry
 * their `@Response(401)` and `@Response(404)`, those cases move here.
 */
import type { CorpusCase } from './drive.js'

const ADMIN = { userId: 'user-admin', clientId: 'web_app' }
const RESTRICTED = { userId: 'user-restricted', clientId: 'web_app' }

export const SESSION_CORPUS: CorpusCase[] = [
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
        expiresAfterMins: 60
      }
    }
  },
  {
    id: 'session-summary-as-admin',
    route: 'GET /SASjsApi/session/{sessionId}',
    description: "answers an administrator another account's session",
    request: { subject: ADMIN, params: { sessionId: 'sess-restricted' } },
    expect: {
      status: 200,
      body: {
        sessionId: 'sess-restricted',
        state: 'running',
        pid: 4243,
        creationTimeStamp: '2026-11-07T09:05:00.000Z'
      }
    }
  },
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
    id: 'session-output-own',
    route: 'GET /SASjsApi/session/{sessionId}/output',
    description: 'answers the webout this session produced',
    request: { subject: ADMIN, params: { sessionId: 'sess-admin' } },
    expect: { status: 200, contents: '<html><body>42</body></html>' }
  },
  {
    id: 'session-state-own',
    route: 'GET /SASjsApi/session/{sessionId}/state',
    description: "answers the run time's state for this session",
    request: { subject: RESTRICTED, params: { sessionId: 'sess-restricted' } },
    expect: {
      status: 200,
      body: { state: 'running', pid: 4243, lineCount: 3 }
    }
  }
]
