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
import fs from 'node:fs'
import path from 'node:path'
import type {
  AdminReports,
  AuthConfig,
  DirectoryStore,
  WebPage,
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
  TriggerResponse,
  InfoResponse,
  InfoService
} from '../src/index.js'
import * as api from '../src/index.js'
import { BROWSER_INFO, createInfoService, isApiError } from '../src/index.js'

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

  it('the info service and the answer it states', async () => {
    // the host implements the configuration and the package implements the
    // shape, so both halves have to be nameable from the entry point
    const service: InfoService = createInfoService(BROWSER_INFO)
    const answer: InfoResponse = await service.info()

    expect(answer.runTimes).toEqual(['js'])
    expect(answer.httpPort).toBeNull()
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

const SRC = path.join(__dirname, '..', 'src')

/**
 * The factories the tree defines, read out of `src/<module>/service.ts`.
 *
 * Derived rather than listed: a hand-maintained list is the thing this guard was
 * written to replace, and it cannot see the case it exists for - a new
 * `create*Service` that nobody adds to the entry point. `src/code` is the one
 * deliberate exception: the editor's service pulls in `@sasjs/lint`, which reads
 * the filesystem, so it is reachable at `@sasjs/api/code` and never from the
 * root - a host that wants it imports the subpath.
 */
const factoriesInTree = (): string[] => {
  const names: string[] = []

  for (const entry of fs.readdirSync(SRC, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'code') continue

    const file = path.join(SRC, entry.name, 'service.ts')
    if (!fs.existsSync(file)) continue

    for (const match of fs
      .readFileSync(file, 'utf8')
      .matchAll(/export const (create[A-Za-z]+Service)\b/g))
      names.push(match[1])
  }

  return names
}

/** The corpora the tree defines, from every `src/corpus/*.ts`. */
const corporaInTree = (): string[] => {
  const folder = path.join(SRC, 'corpus')

  return fs
    .readdirSync(folder)
    .filter((name) => name.endsWith('.ts'))
    .flatMap((name) =>
      [
        ...fs
          .readFileSync(path.join(folder, name), 'utf8')
          .matchAll(/export const ([A-Z_]+_CORPUS)\b/g)
      ].map((match) => match[1])
    )
}

describe('the entry point exports every service a host needs', () => {
  it('exports every factory the tree defines', () => {
    const factories = factoriesInTree()

    // the scanner has to have found something, or the assertion below passes on
    // an empty list for ever
    expect(factories).toEqual(expect.arrayContaining(['createDriveService']))

    expect(
      factories.filter(
        (name) => typeof (api as Record<string, unknown>)[name] !== 'function'
      )
    ).toEqual([])
  })

  it('exports every corpus the tree defines', () => {
    const corpora = corporaInTree()

    expect(corpora).toEqual(expect.arrayContaining(['DRIVE_CORPUS']))

    expect(
      corpora.filter(
        (name) => !Array.isArray((api as Record<string, unknown>)[name])
      )
    ).toEqual([])
  })

  it('and the types a host states its configuration with', () => {
    // compile-time proof: these imports fail the suite if the entry point stops
    // exporting them, which is the only way a type export can be asserted
    const authConfig: AuthConfig = {}
    const reports: AdminReports = {
      diagnostics: async () => ({}) as never,
      logs: async () => [],
      logTail: async () => undefined
    }
    const store: DirectoryStore = {} as DirectoryStore
    const page: WebPage = { html: '', version: '' }

    expect([authConfig, reports, store, page]).toHaveLength(4)
  })
})
