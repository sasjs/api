/**
 * The emulated compute estate: sessions, jobs and the logs generated for them.
 *
 * A session is a handle a client keeps and asks about later, so it lives in the
 * process that issued it - the way a real compute server's does - and it survives
 * as long as the emulator does. Ids are a function of the seed and a counter
 * rather than a random uuid: a session id that changes between runs would break
 * every fixture that names one, which is the same rule as a folder id.
 *
 * Nothing here executes SAS. The engine is not present, and a log that claimed to
 * be output would be a lie the first time somebody read it. The log echoes what
 * was submitted and states, in the log itself, that it is generated - so a client
 * that parses for NOTEs still gets a well-formed log, and a person reading it is
 * not misled about what ran.
 */
import { drawFrom, drawInt, generator, hash } from './seed.js'

/** One submitted job, and what the emulator answered for it. */
export interface EmulatedJob {
  id: string
  name: string
  /** The lines the emulated log returns, in order. */
  log: string[]
  /** What the host's engine returned, when the host ran the program. */
  webout?: string
  /**
   * Where the job is.
   *
   * A job with no engine is completed the moment it is accepted: there is
   * nothing to run. A job a host runs is `running` until the host answers,
   * because the client polls this and a submission that answered `completed`
   * would be a lie about work that had not happened.
   */
  state: 'running' | 'completed' | 'failed'
  creationTimeStamp: string
  /**
   * When the run finished, absent until it does.
   *
   * A job that has not settled has no completion time: answering one would tell
   * a client that work finished at the moment it was accepted.
   */
  completedTimeStamp?: string
  sessionId: string
}

export interface EmulatedSession {
  id: string
  /** When it was created, on the real clock: a client expires sessions by age. */
  createdAt: string
  jobs: Map<string, EmulatedJob>
  /** How many jobs this session has accepted, so ids are stable per session. */
  submitted: number
}

/** What a submitted job answers before it is run - the same for every request. */
export interface SubmittedJob {
  name?: string
  description?: string
  /**
   * The program.
   *
   * A string or a list of lines: `@sasjs/adapter` posts an array of lines, and
   * the capture recorded a string because the recorder posted one. Both are the
   * same program, so both are accepted.
   */
  code?: string | string[]
}

/**
 * The generated log for one program.
 *
 * Deterministic in (seed, code): the same program on the same estate answers the
 * same lines, so a test can assert a log and a screenshot stays true. The numbers
 * are drawn rather than fixed so that two estates do not look identical, and the
 * generator is re-seeded from the code for each job so that one job's log does not
 * depend on how many jobs ran before it.
 */
export const logFor = (seed: number, program: string | string[]): string[] => {
  const code = Array.isArray(program) ? program.join('\n') : program
  // seeded from the program's TEXT, not its length: two programs of the same
  // length are two programs, and a fixture that names the numbers would be
  // right for both of them otherwise
  const next = generator(seed ^ hash(`code:${code}`))
  const rows = drawInt(next, 900) + 100
  const seconds = (drawInt(next, 90) + 10) / 100

  const lines = code
    .split('\n')
    .map((line, index) => `${String(index + 1).padStart(3, ' ')}    ${line}`)

  return [
    'NOTE: Emulated compute engine - this log is generated, not produced by SAS.',
    'NOTE:  No library was touched: the emulated engine has none.',
    ...lines,
    `NOTE: The data set WORK.EMULATED has ${rows} observations and 3 variables.`,
    `NOTE:  DATA statement used (Total process time):`,
    `NOTE:      real time           ${seconds.toFixed(2)} seconds`,
    `NOTE:      user cpu time       ${(seconds / 2).toFixed(2)} seconds`,
    `NOTE:  ${drawFrom(next, ['The emulated run completed.', 'Emulation complete - no SAS was executed.'])}`
  ]
}

/**
 * The sessions one estate holds.
 *
 * Keyed by seed, so two emulated estates in one process - a test that runs two
 * targets - do not share a session namespace.
 */
export class EmulatedEstate {
  private readonly sessions = new Map<string, EmulatedSession>()

  private created = 0

  constructor(private readonly seed: number) {}

  /** A new session: deterministic id, no jobs. */
  create(): EmulatedSession {
    const session: EmulatedSession = {
      id: `emulated-${this.seed.toString(16)}-ses${String(this.created++).padStart(4, '0')}`,
      createdAt: new Date().toISOString(),
      jobs: new Map(),
      submitted: 0
    }

    this.sessions.set(session.id, session)

    return session
  }

  session(id: string): EmulatedSession | undefined {
    return this.sessions.get(id)
  }

  remove(id: string): boolean {
    return this.sessions.delete(id)
  }

  /** A job accepted into a session, with the log the emulator generated for it. */
  submit(session: EmulatedSession, job: SubmittedJob): EmulatedJob {
    const id = `${session.id}-job${String(session.submitted++).padStart(4, '0')}`
    const code = job.code ?? ''

    const submitted: EmulatedJob = {
      id,
      name: job.name ?? id,
      // the log is a function of the seed and the program alone, so the same
      // program answers the same lines whatever session it was submitted in
      log: logFor(this.seed, code),
      state: 'running',
      // the real clock, unlike a folder's: a client computes a session's age
      // from this stamp and expires it, so a fixed instant in the past is a
      // session that is born expired
      creationTimeStamp: new Date().toISOString(),
      // no completion stamp here: a job is finished when something finished it,
      // and the handler that knows whether anything will run sets both
      sessionId: session.id
    }

    session.jobs.set(id, submitted)

    return submitted
  }
}

/** One estate per seed, for the life of the process. */
const estates = new Map<number, EmulatedEstate>()

export const estateFor = (seed: number): EmulatedEstate => {
  const existing = estates.get(seed)

  if (existing) return existing

  const estate = new EmulatedEstate(seed)

  estates.set(seed, estate)

  return estate
}
