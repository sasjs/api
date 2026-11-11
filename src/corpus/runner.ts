/**
 * Runs a corpus case against a drive the case seeds itself.
 *
 * The runner exists so the corpus is data rather than a spec file: a host proves
 * its conformance by supplying something that answers `dispatch`, and the
 * assertions live in one place. Today that is this package's services over a
 * `MemoryDriveStore`; a live server and the browser build plug in through their
 * own transports and the same cases run there.
 */
import type { CorpusCase } from './drive.js'
import { dispatch } from '../host/dispatch.js'
import type { Services } from '../host/dispatch.js'
import { createDriveService } from '../drive/service.js'
import { MemoryDriveStore } from '../drive/memory-store.js'
import {
  MemoryAppStreamStore,
  createAppStreamService
} from '../appstream/service.js'
import { createIdentityService } from '../identity/service.js'
import { createRecordService } from '../identity/records.js'
import { createSessionService } from '../session/service.js'
import { createRuntimeService } from '../runtime/service.js'
import { MemorySessionRunner } from '../runtime/memory-runner.js'
import { BROWSER_INFO, createInfoService } from '../info/service.js'
import { createAuthConfigService } from '../authconfig/service.js'
import { createAdminService } from '../admin/service.js'
import { createDirectoryService } from '../directory/service.js'
import { CORPUS_AUTH_CONFIG } from './authconfig.js'
import { CORPUS_DIAGNOSTICS, CORPUS_LOG, CORPUS_LOG_TAIL } from './admin.js'
import { CORPUS_DIRECTORY } from './directory.js'
import { createHomeService } from '../home/service.js'
import { CORPUS_WEB_PAGE } from './home.js'
import { MemoryIdentityStore } from '../identity/memory-store.js'
import { DEFAULT_IDENTITY } from '../identity/fixture.js'
import { isApiError } from '../types.js'

/**
 * The app every app-stream case starts from: one published app, at the folder the
 * unpublish cases name, so a removal has something to remove. Its id is stated
 * rather than minted, because a case that pins "the id that is there" cannot
 * invent one.
 */
export const CORPUS_APP = {
  id: '6f1c1c1e-6a1e-4c4a-9d1a-1b2c3d4e5f60',
  name: 'myApp',
  appLoc: '/Public/myApp',
  streamWebFolder: 'web',
  publishedAt: '2026-01-01T00:00:00.000Z'
}

export interface CaseResult {
  status: number
  body?: unknown
  contents?: string | Uint8Array
  /** The refusal's message, when the case was refused. */
  error?: string
}

/**
 * Services over fresh stores, seeded with the case's files and identity.
 *
 * The identity store is built for every case, drive or not, so a case that starts
 * mid-flow can declare the tokens and codes it begins with.
 */
export const servicesFor = (testCase: CorpusCase): Services => {
  // one identity store, shared by both services: a token the sign-in flow issues
  // has to be the token a record route reads, and a user a record route creates
  // has to be one the flow can sign in. Two stores built from the same fixture
  // would let a case assert across two independent states and still pass.
  const identity = new MemoryIdentityStore(
    testCase.identity || DEFAULT_IDENTITY
  )

  // one runner, shared by the runtime routes and the session routes: a session a
  // trigger creates has to be one the session routes can read
  const runner = new MemorySessionRunner({
    fail: testCase.failingRun,
    outputs: testCase.runOutput
      ? { [programOf(testCase)]: testCase.runOutput }
      : undefined
  })

  return {
    drive: createDriveService(
      testCase.unwritable
        ? new RefusingDriveStore(testCase.seed || {})
        : new MemoryDriveStore(testCase.seed || {})
    ),
    info: createInfoService(BROWSER_INFO),
    home: createHomeService(async () => CORPUS_WEB_PAGE),
    authConfig: createAuthConfigService(CORPUS_AUTH_CONFIG),
    admin: createAdminService({
      diagnostics: async () => CORPUS_DIAGNOSTICS,
      logs: async () => [CORPUS_LOG],
      logTail: async (fileName: string) =>
        fileName === CORPUS_LOG.name ? CORPUS_LOG_TAIL : undefined
    }),
    directory: createDirectoryService(identity, CORPUS_DIRECTORY),
    identity: createIdentityService(identity),
    records: createRecordService(identity),
    appStream: createAppStreamService(new MemoryAppStreamStore([CORPUS_APP])),
    session: createSessionService(identity, runner),
    // no `runTimes` option: the default is the five the document names, so a
    // case is never refused for a reason that belongs to one host's install
    runtime: createRuntimeService(identity, runner)
  }
}

/** The program a case runs, keyed the way the runner is keyed by it. */
const programOf = (testCase: CorpusCase): string =>
  String(
    testCase.request.query?._program ??
      testCase.request.body?._program ??
      testCase.request.body?.code ??
      ''
  )

/**
 * A drive that reads but refuses every write.
 *
 * Only the corpus uses it: `POST /drive/deploy` answers `500` when storing
 * fails, and a case for that answer needs a store that fails.
 */
class RefusingDriveStore extends MemoryDriveStore {
  override async write(): Promise<void> {
    throw new Error('the store refused the write')
  }

  override async mkdirp(): Promise<void> {
    throw new Error('the store refused the write')
  }
}

/**
 * The drive state a case says it leaves, checked where the case states it.
 *
 * Reported as a thrown error naming the case rather than as a status mismatch: a
 * host that dropped the deploy option answers `200` and fails here, which is the
 * only place the difference between "replaced" and "kept" can be seen.
 */
const checkDrive = async (
  testCase: CorpusCase,
  services: Services
): Promise<void> => {
  if (!testCase.expectDrive || !services.drive) return

  const holds = async (path: string): Promise<boolean> => {
    try {
      await services.drive!.read(path)
      return true
    } catch (e) {
      return false
    }
  }

  for (const path of testCase.expectDrive.present || [])
    if (!(await holds(path)))
      throw new Error(
        `${testCase.id}: expected a file at ${path}, and the drive has none`
      )

  for (const path of testCase.expectDrive.missing || [])
    if (await holds(path))
      throw new Error(
        `${testCase.id}: expected no file at ${path}, and the drive still holds one`
      )
}

/**
 * Runs a corpus case against the drive the case seeds itself, or against
 * services a caller supplies - that is how a host (or a failing store) is put
 * behind the same cases.
 */
export const runCase = async (
  testCase: CorpusCase,
  services: Services = servicesFor(testCase)
): Promise<CaseResult> => {
  try {
    const response = await dispatch(services, testCase.route, testCase.request)
    await checkDrive(testCase, services)
    return {
      status: response.status,
      body: response.body,
      contents: response.contents
    }
  } catch (error) {
    // only a refusal the API decided on becomes a status; anything else is a
    // broken host, and reporting it as a 500 would hide it from the suite
    if (isApiError(error))
      return { status: error.status, body: error.body, error: error.message }
    throw error
  }
}
