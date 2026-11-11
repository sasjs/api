/**
 * The runtime routes: running a program, and starting one.
 *
 * Five operations run work - `code/execute`, `code/trigger`, both `stp/execute`
 * and `stp/trigger` - and what they have in common is the part this package can
 * decide: who may ask, what a valid request is, the session record a trigger
 * creates, its ownership and its retention, and what a refusal says. What it
 * cannot decide is whether there is a SAS binary, a JavaScript worker or
 * anything at all to hand the program to, so that is one port: `SessionRunner`.
 *
 * A session is a transient run - a temporary folder plus a process, producing a
 * log and an `_webout`, then destroyed. The routes expose the record and the
 * artefacts, never the process, which is why a mock can carry them too: it holds
 * records and bytes as well as a host does, and it can even do the work for a
 * run time it has. The one thing it cannot supply is a `pid`, and every response
 * that would carry one carries it as optional.
 */
import { ApiError } from '../types.js'
import { DOCUMENTED_RUN_TIMES } from './runTimes.js'
import { programNotFound, runTimeOfPath } from './program.js'
import type { IdentityUserRecord, Subject } from '../identity/types.js'
import type { CallerDirectory, SessionArtifact } from '../session/service.js'
import { normaliseDrivePath } from '../drive/paths.js'

/**
 * The value that asks for the session log.
 *
 * `_debug` follows the SAS Application Broker's convention, where the value is a
 * set of bit flags - 128 returns the log, 2 prints timing, 1 echoes the fields -
 * so 131 is LOG + TIME + FIELDS, which is what @sasjs/core's `ms_runstp`
 * defaults to and what the generated services test with `%if &_debug ge 131`.
 *
 * The two code routes force it on, because their documented response body is
 * assembled from the webout, the log and the listing: a client that runs code
 * and receives only the webout would be told nothing about a program that failed
 * with an empty `_webout`. The stored-program routes leave it to the caller, so
 * `GET /stp/execute` without `_debug` answers the program's output and nothing
 * else.
 */
export const CODE_DEBUG = 131

/**
 * `_debug`, normalised the way sasjs/server's `parseDebugValue` normalises it.
 *
 * The parameter's one effect is whether the log comes back, and the macros test
 * it numerically (`%if &_debug ge 131`), so a keyword cannot be handed to a
 * program as text: `_debug=log` would arrive as the string `log`, the comparison
 * would fail, and the caller would receive a body without the log section the
 * same request gets from a server. Integer text is a level; any other non-empty
 * value means "the log, please"; absent or empty means it was not asked for.
 *
 * `1e3` and `0x10` are text, not levels - `Number()` would read them as 1000 and
 * 16, neither of which the macros' comparison treats as the log.
 */
export const parseDebugValue = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined

  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined

  const text = String(value).trim()
  if (!text) return undefined

  return /^[+-]?\d+$/.test(text) ? Number(text) : CODE_DEBUG
}

/**
 * A session a trigger created.
 *
 * The package mints the id, because the document defines it as the name of the
 * temporary folder and a client polls the session routes by it; the host records
 * the session under that id before it runs anything, which is what makes the
 * session routes answer afterwards.
 *
 * `owner` is the caller's **uid**, for the same reason the session routes
 * compare uids first: a username is mutable client data - an account can be
 * renamed, two accounts can exchange names - and a name-keyed record hands a
 * session to whoever holds the name later.
 */
export interface RunnerSession {
  sessionId: string
  owner: string
  /** The run time the caller named, when they named one. */
  runTime?: string
  /** Minutes after completion at which the session must be destroyed. */
  expiresAfterMins?: number
}

/**
 * The program to run: its source, or the drive path that names it.
 *
 * A union rather than two optional fields, so a host cannot be handed a request
 * with neither and quietly run nothing.
 *
 * A path arrives normalised and contained, and the package has already taken the
 * run time from its extension when it carries a recognised one. What it cannot
 * do is *find* the file: a path with no extension is the form every document
 * example uses, and the server answers it by probing `<path>.<runTime>` for each
 * run time it holds - a filesystem question, so the runner resolves the file and
 * the run time that goes with it, exactly as `getRunTimeAndFilePath` does
 * upstream. That is the one thing a runner must do beyond opening what it is
 * given.
 */
export type ProgramSource = { code: string } | { path: string }

/** One request to run something. */
export interface RunRequest {
  program: ProgramSource
  /**
   * The variables the program sees: the request's query and body as the caller
   * sent them, with `_debug` normalised the way the server's own handlers
   * normalise it - a number stays one, integer text becomes a number, and any
   * other non-empty value means "return the log" (131). Everything else is the
   * caller's, untouched: a session variable is whatever a client named it.
   */
  vars: Record<string, unknown>
  /**
   * The run time to use: the one the caller named, or the one a stored
   * program's extension names (`/app/run.js` is JavaScript). Absent when nothing
   * names one, and then the run time is the host's own choice.
   */
  runTime?: string
  /**
   * The session this run belongs to. Present for a trigger, absent for an
   * execute: an execute waits for the program and answers its output, and the
   * caller never sees a session.
   */
  session?: RunnerSession
  /** Multipart files the request carried, by field name. */
  files?: Record<string, string | Uint8Array>
}

/** What a run produced, as far as the host can tell. */
export interface RunOutcome {
  /**
   * The program's output: `_webout`, with the session log when the run was
   * asked to return it. Absent when the program wrote nothing.
   */
  output?: SessionArtifact
  /** The OS process, where the host runs one and knows its id. */
  pid?: number
}

/**
 * A host's run time, as the package sees it.
 *
 * One method, because performing work is the only thing the package cannot
 * compute. Everything a client observes around it - the id, the record, who may
 * read it, the refusals - is decided here.
 */
export interface SessionRunner {
  run(request: RunRequest): Promise<RunOutcome>
}

/** What a trigger answers: the session to poll, and the process when there is one. */
export interface TriggerResponse {
  sessionId: string
  pid?: number
}

/**
 * One run, in the shape a caller of the service states it.
 *
 * `program` and `code` are the two sources the document names - a drive path on
 * the stored-program routes, a buffer on the code routes - and `source` says
 * which one the route promised. It is not derivable from the payload: a request
 * with neither field still has to name the right parameter in its refusal, and
 * the stored-program and code schemas disagree about what is required
 * (`runTime` is required on the code routes, and resolved from the file's
 * extension on the stored-program ones).
 */
export interface RuntimeRequest {
  /** Which source the route promised. */
  source: 'program' | 'code'
  /** The drive path of a stored program. */
  program?: string
  /** The code to run, instead of a stored program. */
  code?: string
  /** The run time the caller named. */
  runTime?: string
  /** The request's own parameters, which the program sees as session variables. */
  vars?: Record<string, unknown>
  /** Multipart files the request carried, by field name. */
  files?: Record<string, string | Uint8Array>
  /**
   * Minutes after completion at which the session must be destroyed.
   *
   * A query parameter carries this as text, so both forms are accepted and the
   * schema's coercion is the service's job.
   */
  expiresAfterMins?: number | string
}

export interface RuntimeServiceOptions {
  /**
   * The run times the host holds.
   *
   * A host decides which languages it holds - the browser build runs JavaScript,
   * a server runs JavaScript and SAS - and the document's `RunTimeType` names the
   * five that exist. A name outside this list is the caller's mistake, which is
   * the server's `400` ("`runTime` must be one of [sas, js]") rather than the
   * `501` a capability answers: the route exists, the request cannot be served.
   */
  runTimes?: string[]
}

export interface RuntimeService {
  /** Run a program to completion and answer what it produced. */
  execute(
    caller: Subject | undefined,
    request: RuntimeRequest
  ): Promise<SessionArtifact>
  /** Start a program in a new session and answer the session to poll. */
  trigger(
    caller: Subject | undefined,
    request: RuntimeRequest
  ): Promise<TriggerResponse>
}

/** Two digits, for the timestamp a session id starts with. */
const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * The timestamp a session id starts with: `YYYYMMDDHHMMSS`.
 *
 * Local time, which is what sasjs/server's `generateTimestamp` writes and what
 * makes the id read as a SAS work folder name. Nothing derives from it - the id
 * is opaque to a client - so a host in another time zone minting another string
 * is not a divergence.
 */
const timestamp = (now: Date): string =>
  [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('')

/**
 * A session id in the shape the document shows: `20241028074744-54132-1730101664824`.
 *
 * The trailing milliseconds make two triggers in the same second distinct even
 * when the random part collides, which matters because the id names a folder: a
 * collision would put two runs in one session.
 */
const newSessionId = (now: Date): string =>
  `${timestamp(now)}-${Math.round(Math.random() * 100000)}-${now.getTime()}`

/** The refusal a program that cannot be found answers, as the server words it. */
// the wording is `resolveProgram`'s, so the module that decides the rule and the
// route that renders it cannot drift apart
const notThere = (programPath: string): string => programNotFound(programPath)

/**
 * The failure a run that could not be performed answers.
 *
 * The message is sasjs/server's, verbatim, because a client keys on it: the
 * response body is `{status: 'failure', message, error}`, where `error` is the
 * runner's own text. A host's bug must not become a `500` here - a `500` says
 * the API happened to break, and this says the program did not run.
 */
const failedRun = (error: unknown): never => {
  const message = 'Job execution failed.'
  // `String(error)` keeps the prefix an Error carries (`Error: ...`), which is
  // what the server sends: it stringifies the rejection rather than reading
  // `.message` off it
  throw new ApiError(400, message, {
    status: 'failure',
    message,
    error: String(error)
  })
}

/**
 * The five runtime routes, over a host's runner.
 *
 * The caller passes a `Subject` and nothing else: which account that is, whether
 * it is still active, and what it is allowed to run are resolved here, against
 * the same directory the session routes read. A host never states a role.
 */
export const createRuntimeService = (
  directory: CallerDirectory,
  runner: SessionRunner,
  options: RuntimeServiceOptions = {}
): RuntimeService => {
  const runTimes = options.runTimes || DOCUMENTED_RUN_TIMES

  /** The caller, refused the way the middleware refuses one. */
  const callerOf = async (
    caller: Subject | undefined
  ): Promise<IdentityUserRecord> => {
    if (!caller) throw new ApiError(401, 'Unauthorized')

    const reader = await directory.userById(caller.userId)
    // a deactivated account keeps a token the sign-in flow issued before it was
    // deactivated, and the server's middleware refuses it on every route
    if (!reader || !reader.isActive) throw new ApiError(401, 'Unauthorized')
    return reader
  }

  /**
   * The program a request names, refused in the schema's own words.
   *
   * `_program` is caller-controlled and names a file under the host's drive, so
   * it is resolved against the drive root before a runner sees it: a path that
   * climbs out with `..` would otherwise let a caller run any file the service
   * account can read, which is why sasjs/server resolves it with
   * `resolveWithinDrive` before looking for the program. A path that leaves the
   * drive is refused the way a program that is not there is refused - the same
   * `400`, because saying "your path was rejected but existed" would say
   * something about the host's filesystem.
   */
  const programOf = (request: RuntimeRequest): ProgramSource => {
    // a refusal names the parameter its own route declared: a code route told
    // its caller that "_program" is missing is answering about a field the
    // route never had
    if (request.source === 'code') {
      if (request.code === undefined)
        throw new ApiError(400, '"code" is required')

      if (typeof request.code !== 'string')
        throw new ApiError(400, '"code" must be a string')
      if (request.code === '')
        throw new ApiError(400, '"code" is not allowed to be empty')

      return { code: request.code }
    }

    if (request.program === undefined)
      throw new ApiError(400, '"_program" is required')

    if (typeof request.program !== 'string')
      throw new ApiError(400, '"_program" must be a string')
    if (request.program === '')
      throw new ApiError(400, '"_program" is not allowed to be empty')

    const resolved = normaliseDrivePath(request.program)
    if (resolved === null) return failedRun(notThere(request.program))

    return { path: resolved }
  }

  /**
   * The run time a stored program's path names, if it names one.
   *
   * `_program=/app/run.js` is JavaScript, and the server treats it that way
   * before it looks for the file (`getRunTimeAndFilePath` reads the extension).
   * Only the extension vocabulary the document states is read, so `run.sas7bdat`
   * or `run.backup` name no run time and are left to the host.
   */
  const runTimeForPath = (
    path: string,
    request: RuntimeRequest
  ): string | undefined =>
    // the extension rule is `resolveProgram`'s; this asks it and falls back to what
    // the request stated, which is the part that is this route's
    runTimeOfPath(path) ?? runTimeOf(request)

  /** The run time, refused when it is absent where the document requires it, or unheld. */
  const runTimeOf = (request: RuntimeRequest): string | undefined => {
    if (request.runTime === undefined) {
      // the code routes document `runTime` as required; a stored program's run
      // time is the host's to resolve from the path, so absent is normal there
      if (request.source === 'code')
        throw new ApiError(400, '"runTime" is required')
      return undefined
    }

    if (typeof request.runTime !== 'string')
      throw new ApiError(400, '"runTime" must be a string')

    if (!runTimes.includes(request.runTime))
      throw new ApiError(
        400,
        `"runTime" must be one of [${runTimes.join(', ')}]`
      )

    return request.runTime
  }

  /**
   * Retention, refused when it is not a positive number of minutes.
   *
   * A query string carries text, and the server's schema coerces it -
   * `?expiresAfterMins=15` is the same request as `"expiresAfterMins": 15` - so
   * the coercion is part of the contract rather than a convenience. Only a
   * number, or text shaped like one, is read: `15abc` and `1e3` are refused (the
   * first is not a number to Joi either, the second is not the shape a client
   * sends), while `1.5` is accepted because `number().greater(0)` takes decimals.
   *
   * Retention belongs to a trigger and only to a trigger: an execute waits for
   * the program, so an `expiresAfterMins` on its request is a session variable
   * like any other, and validating one would refuse a request the server answers.
   */
  const expiryOf = (request: RuntimeRequest): number | undefined => {
    const value = request.expiresAfterMins
    if (value === undefined) return undefined

    const minutes =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\s*[+-]?\d+(\.\d+)?\s*$/.test(value)
          ? Number(value)
          : NaN

    if (Number.isNaN(minutes))
      throw new ApiError(400, '"expiresAfterMins" must be a number')

    if (minutes <= 0)
      throw new ApiError(400, '"expiresAfterMins" must be greater than 0')

    return minutes
  }

  /** The request, validated and normalised, with its caller resolved. */
  const prepare = async (
    caller: Subject | undefined,
    request: RuntimeRequest
  ) => {
    const reader = await callerOf(caller)
    const program = programOf(request)
    const vars = { ...(request.vars || {}) }

    // the code routes force the log on, because their documented body is
    // assembled from it; a stored program's caller decides, and a keyword there
    // means the same thing a number does. A caller who did not ask for the log
    // keeps no `_debug` key at all: a host that walks the entries to build a
    // query string or a header map would otherwise emit `_debug=undefined`.
    const debug = 'code' in program ? CODE_DEBUG : parseDebugValue(vars._debug)
    if (debug === undefined) delete vars._debug
    else vars._debug = debug

    return {
      reader,
      program,
      vars,
      // a code route's run time is the one it named; a stored program's is the
      // one its extension names, when it names one at all
      runTime:
        'code' in program
          ? runTimeOf(request)
          : runTimeForPath(program.path, request)
    }
  }

  return {
    async execute(caller, request) {
      const prepared = await prepare(caller, request)

      let outcome: RunOutcome
      try {
        outcome = await runner.run({
          program: prepared.program,
          vars: prepared.vars,
          runTime: prepared.runTime,
          files: request.files
        })
      } catch (error) {
        return failedRun(error)
      }

      // a program that wrote nothing is an empty body, not a missing one: the
      // route answered, and "no output" is the answer
      return outcome.output || { contents: '' }
    },

    async trigger(caller, request) {
      const prepared = await prepare(caller, request)
      const expiresAfterMins = expiryOf(request)

      const session: RunnerSession = {
        sessionId: newSessionId(new Date()),
        owner: prepared.reader.uid,
        ...(prepared.runTime === undefined
          ? {}
          : { runTime: prepared.runTime }),
        ...(expiresAfterMins === undefined ? {} : { expiresAfterMins })
      }

      let outcome: RunOutcome
      try {
        outcome = await runner.run({
          program: prepared.program,
          vars: prepared.vars,
          runTime: prepared.runTime,
          session,
          files: request.files
        })
      } catch (error) {
        return failedRun(error)
      }

      return outcome.pid === undefined
        ? { sessionId: session.sessionId }
        : { sessionId: session.sessionId, pid: outcome.pid }
    }
  }
}
