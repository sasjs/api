/**
 * A runner that needs no process, and the sessions it creates.
 *
 * The corpus and a browser build have the same problem: nothing to hand a
 * program to. A memory runner answers it the way a mock should - it holds the
 * record, the state, the log and the output of a session, and it finishes
 * synchronously - which is why "the same API" can be checked without a SAS
 * binary on the box. The one thing it cannot supply is a `pid`, and every
 * response that would carry one carries it as optional.
 *
 * It is also a `SessionHost`, because a session a trigger created has to be one
 * the session routes can read: two maps behind two ports would let a trigger
 * write a record nothing can poll, which is the class of mistake the package
 * exists to end.
 */
import { MemorySessionHost } from '../session/memory-host.js'
import type { HostSession, SessionArtifact } from '../session/service.js'
import type { RunOutcome, RunRequest, SessionRunner } from './service.js'

export interface MemoryRunnerOptions {
  /**
   * What a program produces, by the code or the drive path it named.
   *
   * A mock cannot know what a program writes, so it writes nothing unless a test
   * says otherwise - and a test that pins an output needs one it can state, which
   * is what this is for.
   */
  outputs?: Record<string, SessionArtifact>
  /** Refuse every run, so a test can pin what a failed run answers. */
  fail?: boolean
  /** The process id to report, for a host that has one. */
  pid?: number
}

export class MemorySessionRunner
  extends MemorySessionHost
  implements SessionRunner
{
  constructor(private readonly options: MemoryRunnerOptions = {}) {
    super()
  }

  async run(request: RunRequest): Promise<RunOutcome> {
    if (this.options.fail) throw new Error('the mock run failed')

    const key =
      'code' in request.program ? request.program.code : request.program.path
    const output = this.options.outputs?.[key] || { contents: '' }
    const pid = this.options.pid

    // a session is recorded before the work is reported done, because the id in
    // the trigger's response is what a client polls with
    if (request.session) {
      const { sessionId, owner, expiresAfterMins } = request.session
      const started = new Date().toISOString()

      const summary: HostSession['summary'] = {
        sessionId,
        // the work is finished by the time this returns: a memory runner has
        // nothing to wait for, and the session routes report what it did
        state: 'completed',
        creationTimeStamp: started,
        deathTimeStamp: started
      }

      if (pid !== undefined) summary.pid = pid
      if (expiresAfterMins !== undefined)
        summary.expiresAfterMins = expiresAfterMins

      this.sessions[sessionId] = { owner, summary }
      this.states[sessionId] =
        pid === undefined ? { state: 'completed' } : { state: 'completed', pid }
      this.logs[sessionId] = ''
      this.outputs[sessionId] = output
    }

    return pid === undefined ? { output } : { output, pid }
  }
}
