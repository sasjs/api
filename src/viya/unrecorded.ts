/**
 * The in-scope operations the captures do not describe, and why.
 *
 * Phase 0's exit criterion is "every operation carries a captured case or a
 * stated reason". This is the stated reason, in a form a check can read: an
 * operation that leaves this file joins `src/viya/table.ts` instead, and one
 * that joins the table must leave this file - the two are a partition of the
 * in-scope surface, and `spec/viyaTable.spec.ts` holds that.
 *
 * A reason is a claim about what is missing, not a promise of when it arrives:
 * "needs a deployed job definition" tells the next reader which pass to run,
 * where "TODO" tells them nothing.
 */
export interface UnrecordedOperation {
  /**
   * The path, with `{}` for a segment that is an identifier. No verb: the verb
   * lives at the call site and nothing has observed one, so stating a method
   * here would be a guess wearing the same clothes as a measurement.
   */
  path: string
  reason: string
}

export const UNRECORDED: UnrecordedOperation[] = [
  // The recorder hands the adapter a token it obtained itself, so the calls that
  // obtain one never pass through the proxy. The capture tool records them as a
  // separate pass, which needs a client id and secret.
  {
    path: '/SASLogon',
    reason:
      'no capture: the pass authenticates outside the adapter, so the login root is never requested through the client'
  },
  {
    path: '/SASLogon/login',
    reason:
      'no capture: an interactive login; the pass presents a token instead of a form'
  },
  {
    path: '/SASLogon/login.do',
    reason:
      'no capture: an interactive login; the pass presents a token instead of a form'
  },
  {
    path: '/SASLogon/logout',
    reason:
      'no capture: the pass never signs out, because a capture run must leave the estate as it found it'
  },
  {
    path: '/SASLogon/logout.do',
    reason:
      'no capture: the pass never signs out, because a capture run must leave the estate as it found it'
  },
  {
    path: '/SASLogon/oauth/authorize',
    reason:
      'no capture: the authorisation-code step needs a browser; the pass uses the password grant'
  },

  // Compute operations the scripted passes do not reach.
  {
    path: '/compute/sessions/{}/filerefs/_webout/content',
    reason:
      'no capture: the adapter reads the webout fileref only when a run expects one (`expectWebout`); the execute pass submits a `%put` and reads the log'
  },
  {
    path: '/compute/sessions/{}/variables/{}',
    reason:
      "no capture: the adapter reads a session variable only to report a submitted job's pid (`printPid`), which the pass does not set"
  },
  {
    path: '/launcher/contexts',
    reason:
      'no capture: the fallback list, asked for only when the compute context list fails; a healthy estate never reaches it'
  },

  // The job path needs something deployed to run.
  {
    path: '/jobDefinitions/definitions',
    reason:
      'no capture: needs a job definition on the estate. The next pass deploys a service pack under its own app folder and reads the definition back'
  },
  {
    path: '/jobExecution/jobs',
    reason:
      'no capture: needs a deployed service to submit. The next pass deploys a service pack under its own app folder'
  },
  {
    path: '/jobExecution/jobs/{}',
    reason:
      'no capture: follows a submission, so it arrives with the same pass as POST /jobExecution/jobs'
  }
]
