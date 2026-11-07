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
import type { IdentityUserRecord, Subject } from '../identity/types.js'
import type { CallerDirectory, SessionArtifact } from '../session/service.js'

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

/** The run times the published document states, and a host may hold fewer. */
export const DOCUMENTED_RUN_TIMES = ['sas', 'js', 'py', 'r', 'sasviya']

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
 */
export type ProgramSource = { code: string } | { path: string }

/** One request to run something. */
export interface RunRequest {
  program: ProgramSource
  /**
   * The variables the program sees: the request's query and body as the caller
   * sent them, plus `_debug` on the routes that force it. The package does not
   * reshape them - a session variable is whatever a client named it, and the
   * server hands the query through untouched.
   */
  vars: Record<string, unknown>
  /** The run time the caller named. Absent, the host's default applies. */
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
 * the stored-program routes, a buffer on the code routes - and a request carries
 * one of them.
 */
export interface RuntimeRequest {
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

  /** The program a request names, refused in the schema's own words. */
  const programOf = (request: RuntimeRequest): ProgramSource => {
    if (request.program !== undefined) {
      if (typeof request.program !== 'string')
        throw new ApiError(400, '"_program" must be a string')
      if (request.program === '')
        throw new ApiError(400, '"_program" is not allowed to be empty')
      return { path: request.program }
    }

    if (request.code === undefined)
      throw new ApiError(400, '"_program" is required')

    if (typeof request.code !== 'string')
      throw new ApiError(400, '"code" must be a string')
    if (request.code === '')
      throw new ApiError(400, '"code" is not allowed to be empty')

    return { code: request.code }
  }

  /** The run time, refused when the host does not hold it. */
  const runTimeOf = (request: RuntimeRequest): string | undefined => {
    if (request.runTime === undefined) return undefined

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
   * A query string carries text, and the server's schema coerces it - `?expiresAfterMins=15`
   * is the same request as `"expiresAfterMins": 15` - so the coercion is part of
   * the contract rather than a convenience. Only an integer-shaped string is read
   * as a number: `15abc` and `1e3` are refused, because Joi refuses the first and
   * the second is a float-formatting question a retention does not have.
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

    return {
      reader,
      program,
      // the code routes force the log on; a stored program's caller decides
      // whether they want it, and `_debug` stays what they sent
      vars:
        'code' in program
          ? { ...(request.vars || {}), _debug: CODE_DEBUG }
          : request.vars || {},
      runTime: runTimeOf(request),
      expiresAfterMins: expiryOf(request)
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

      const session: RunnerSession = {
        sessionId: newSessionId(new Date()),
        owner: prepared.reader.uid,
        ...(prepared.runTime === undefined
          ? {}
          : { runTime: prepared.runTime }),
        ...(prepared.expiresAfterMins === undefined
          ? {}
          : { expiresAfterMins: prepared.expiresAfterMins })
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
