import type { CorpusCase } from './drive.js'
import type {
  DiagnosticsResponse,
  LogFileInfo,
  LogTail
} from '../admin/service.js'

/**
 * The host reports the corpus answers with.
 *
 * One log file, a diagnostics body with every block the document states, and a
 * tail for that one file. Deterministic, so a case can pin an exact body; a real
 * host's numbers differ, which is why the server's own suite runs the same
 * cases against its API rather than this fixture.
 */
export const CORPUS_LOG: LogFileInfo = {
  name: '20260101000000.log',
  sizeBytes: 118,
  modified: '2026-01-01T00:00:00.000Z'
}

export const CORPUS_LOG_TAIL: LogTail = {
  fileName: CORPUS_LOG.name,
  lines: 1,
  bytesRead: 118,
  truncated: false,
  content: 'GET /SASjsApi/info HTTP/1.1 200 118'
}

export const CORPUS_DIAGNOSTICS: DiagnosticsResponse = {
  build: { version: 'v4.16.2', gitHash: 'cda6114', buildDate: null },
  server: {
    mode: 'desktop',
    uptimeSeconds: 3600,
    startedAt: '2026-01-01T00:00:00.000Z',
    pid: 4242,
    nodeVersion: 'v22.11.0',
    platform: 'linux 5.14.0',
    arch: 'x64',
    cpuCount: 8,
    cpuModel: 'Intel(R) Xeon(R) CPU',
    loadAverage: [0.08, 0.11, 0.15],
    runTimes: ['js'],
    sasjsRoot: '/sasjs_root'
  },
  memory: {
    rssBytes: 1,
    heapTotalBytes: 2,
    heapUsedBytes: 3,
    externalBytes: 4,
    systemTotalBytes: 5,
    systemFreeBytes: 6
  },
  filesystem: null,
  folders: [],
  logs: {
    folder: '/sasjs_root/logs',
    fileCount: 1,
    totalBytes: 118,
    newestFile: CORPUS_LOG.name,
    newestModified: CORPUS_LOG.modified
  }
}

/** The fixture's administrator, and the account the rules do not admit. */
const ADMIN = { userId: 'user-admin', clientId: 'web_app' }
const RESTRICTED = { userId: 'user-restricted', clientId: 'web_app' }

/**
 * The admin corpus: one case per documented status of each route.
 *
 * The `401` is the package's now - the same `mayAdminister` the record routes
 * refuse with - so both halves are cases here, with the administrator's `200`
 * between them. The host's own `500` stays out, as it cannot be produced from a
 * fixture.
 */
export const ADMIN_CORPUS: CorpusCase[] = [
  {
    id: 'admin-diagnostics-answers-the-report',
    route: 'GET /SASjsApi/admin/diagnostics',
    description: 'answers the host diagnostics report field for field',
    request: { subject: ADMIN },
    expect: { status: 200, body: CORPUS_DIAGNOSTICS }
  },
  {
    id: 'admin-logs-lists-the-files',
    route: 'GET /SASjsApi/admin/logs',
    description: 'answers the log files the host holds, newest first',
    request: { subject: ADMIN },
    expect: { status: 200, body: { files: [CORPUS_LOG] } }
  },
  {
    id: 'admin-log-tail-answers-the-tail',
    route: 'GET /SASjsApi/admin/logs/{fileName}',
    description: 'answers the tail of a log the folder holds',
    request: { subject: ADMIN, params: { fileName: CORPUS_LOG.name } },
    expect: { status: 200, body: CORPUS_LOG_TAIL }
  },
  {
    id: 'admin-log-tail-refuses-a-traversal',
    route: 'GET /SASjsApi/admin/logs/{fileName}',
    description:
      'refuses a name that could resolve outside the log folder, before the host is asked',
    request: { subject: ADMIN, params: { fileName: '../20260101000000.log' } },
    expect: { status: 400, error: 'Invalid log file name.' }
  },
  {
    id: 'admin-log-tail-answers-404',
    route: 'GET /SASjsApi/admin/logs/{fileName}',
    description: 'answers 404 for a name the folder does not hold',
    request: { subject: ADMIN, params: { fileName: '20250101000000.log' } },
    expect: { status: 404, error: 'Log file not found.' }
  },
  {
    id: 'admin-diagnostics-refused-to-a-restricted-account',
    route: 'GET /SASjsApi/admin/diagnostics',
    description:
      'refuses a signed-in account that is not an administrator, in the wording verifyAdmin uses',
    request: { subject: RESTRICTED },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'admin-logs-refused-to-a-restricted-account',
    route: 'GET /SASjsApi/admin/logs',
    description: 'refuses the log inventory to a restricted account',
    request: { subject: RESTRICTED },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'admin-log-tail-refused-to-a-restricted-account',
    route: 'GET /SASjsApi/admin/logs/{fileName}',
    description: 'refuses a log tail to a restricted account',
    request: { subject: RESTRICTED, params: { fileName: CORPUS_LOG.name } },
    expect: { status: 401, error: 'Admin account required' }
  },
  {
    id: 'admin-logs-refused-with-no-caller',
    route: 'GET /SASjsApi/admin/logs',
    description: 'refuses a request that carries no caller at all',
    request: {},
    expect: { status: 401, error: 'Unauthorized' }
  }
]
