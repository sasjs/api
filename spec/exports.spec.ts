/**
 * The types a host compiles against, imported from the entry point.
 *
 * A type export cannot be asserted at run time - there is nothing in the emitted
 * JavaScript to look at - so the assertion is the import itself: this file does
 * not compile if the entry point stops re-exporting one of them, and ts-jest
 * fails the suite on a compile error. That is the gap #39 opened (the corpora
 * were exported and the services were not) and the one this caught again:
 * `SessionArtifact` was the type a host needs to implement `SessionHost.output`
 * and it was reachable only by path, so `sasjs/server` could not name the shape
 * its own host method answers with.
 */
import type {
  CallerDirectory,
  DriveStore,
  HostSession,
  SessionArtifact,
  SessionHost,
  SessionStateResponse,
  SessionSummary,
  ProgramSource,
  RunOutcome,
  RunRequest,
  RunnerSession,
  SessionRunner,
  RuntimeRequest,
  RuntimeService,
  TriggerResponse
} from '../src/index.js'
import { isApiError } from '../src/index.js'

describe('the entry point exports the types a host implements', () => {
  it('the session port, including the artefact it answers with', () => {
    const artifact: SessionArtifact = {
      contents: Uint8Array.from([1, 2, 3]),
      contentType: 'application/octet-stream'
    }

    const summary: SessionSummary = { sessionId: 'id', state: 'completed' }

    const host: SessionHost = {
      session: async (): Promise<HostSession | undefined> => ({
        owner: 'uid',
        summary
      }),
      state: async (): Promise<SessionStateResponse | undefined> => ({
        state: 'completed'
      }),
      log: async () => '',
      output: async () => artifact
    }

    const directory: CallerDirectory = { userById: async () => undefined }

    expect(host).toBeDefined()
    expect(directory).toBeDefined()
    expect(artifact.contents).toEqual(Uint8Array.from([1, 2, 3]))
  })

  it('the runtime port', () => {
    const program: ProgramSource = { code: 'data _null_; run;' }
    const session: RunnerSession = { sessionId: 'id', owner: 'uid' }
    const request: RunRequest = { program, vars: {}, session }

    const runner: SessionRunner = {
      run: async (): Promise<RunOutcome> => ({
        output: { contents: 'ran' },
        pid: 1
      })
    }

    const service: RuntimeService = {
      execute: async () => ({ contents: '' }),
      trigger: async (): Promise<TriggerResponse> => ({ sessionId: 'id' })
    }

    const runtimeRequest: RuntimeRequest = { source: 'code', code: 'x' }

    expect(runner).toBeDefined()
    expect(service).toBeDefined()
    expect(request.program).toEqual(program)
    expect(runtimeRequest.source).toBe('code')
    // the refusal predicate is a value export, and a host that catches an
    // ApiError needs it by name rather than by marker
    expect(typeof isApiError).toBe('function')
  })

  it('the drive port', () => {
    const store: DriveStore = {
      read: async () => '',
      write: async () => undefined,
      exists: async () => true,
      stat: async () => ({ directory: false, size: 0 }),
      list: async () => ({ files: [], folders: [] }),
      mkdirp: async () => undefined,
      remove: async () => undefined,
      move: async () => undefined
    }

    expect(store).toBeDefined()
  })
})
