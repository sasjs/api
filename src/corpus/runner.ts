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
import { createIdentityService } from '../identity/service.js'
import { MemoryIdentityStore } from '../identity/memory-store.js'
import { DEFAULT_IDENTITY } from '../identity/fixture.js'
import { isApiError } from '../types.js'

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
export const servicesFor = (testCase: CorpusCase): Services => ({
  drive: createDriveService(
    testCase.unwritable
      ? new RefusingDriveStore(testCase.seed || {})
      : new MemoryDriveStore(testCase.seed || {})
  ),
  identity: createIdentityService(
    new MemoryIdentityStore(testCase.identity || DEFAULT_IDENTITY)
  )
})

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
