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
    path: '/SASLogon/authorize',
    reason:
      "no capture: this is the CLI's sign-in against this server's own auth route, which a Viya estate does not serve"
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
  }
]
