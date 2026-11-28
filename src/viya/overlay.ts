/**
 * What this package answers of the Viya table, and what it declines.
 *
 * `src/viya/table.ts` states what a capture observed. This file states the
 * decision for each of those operations: a handler that answers it, or a reason
 * that travels into the 501 body. Every row needs an entry, and importing this
 * file throws if one is missing - the failure mode the route table already
 * refuses, because a row with no decision reads exactly like a row that is about
 * to be done.
 *
 * A declined row is not a TODO. The reason names what is missing, so a caller
 * that reaches it learns why rather than that something is unimplemented.
 */
import { VIYA_OPERATIONS } from './declared.js'

export interface ViyaOverlayEntry {
  implemented: boolean
  /** Present when declined: what a caller is told, and why. */
  reason?: string
}

/**
 * The token endpoint is the host's.
 *
 * A host that mounts the emulator owns the token port - it is the thing that
 * issues what a client presents - so the emulator declines rather than inventing
 * a second answer to the same question.
 */
const NEEDS_AUTH =
  'The token endpoint is answered by the host that mounts the emulator, which owns the token port.'

/** Definition storage is modelled separately from job execution. */
const NEEDS_JOBS =
  'The emulator stores job definitions but does not model job executions.'

export const SESSION_VARIABLE_REFUSAL =
  'GET /compute/sessions/{}/variables/{} is not emulated. The emulator does not model session variables; the client reads these only to log the pid of a job it is about to submit (SYSJOBID), and any name it asks for is refused here rather than answered with a value the emulator did not run.'

export const VIYA_OVERLAY: Record<string, ViyaOverlayEntry> = {
  // answered here
  'POST /folders/folders': { implemented: true },
  'GET /folders/folders/{}': { implemented: true },
  'PATCH /folders/folders/{}': { implemented: true },
  'GET /folders/folders/{}/members': { implemented: true },
  'GET /folders/folders/@item': { implemented: true },
  'GET /folders/folders/@myRecycleBin': { implemented: true },
  'GET /identities/users/@currentUser': { implemented: true },

  // answered here: the application's own identity reads, declared rather than
  // captured - see src/viya/appSurface.ts for the scope they belong to
  'GET /identities/groups': { implemented: true },
  'GET /identities/groups/{}/members': { implemented: true },
  'GET /identities/users': { implemented: true },
  'GET /identities/users/{}': { implemented: true },
  'GET /identities/users/@currentUser/memberships': { implemented: true },
  'GET /identities/users/{}/memberships': { implemented: true },
  'GET /identities/users/{}/avatar/content': { implemented: true },

  'GET /types/types': { implemented: true },

  // answered here: compute
  'GET /compute/contexts': { implemented: true },
  'GET /compute/contexts/{}': { implemented: true },
  'POST /compute/contexts/{}/sessions': { implemented: true },
  'DELETE /compute/sessions/{}': { implemented: true },
  'POST /compute/sessions/{}/jobs': { implemented: true },
  'GET /compute/sessions/{}/jobs/{}': { implemented: true },
  'GET /compute/sessions/{}/jobs/{}/log': { implemented: true },
  'GET /compute/sessions/{}/jobs/{}/log/content': { implemented: true },
  'GET /compute/sessions/{}/jobs/{}/state': { implemented: true },
  'GET /compute/sessions/{}/state': { implemented: true },

  // answered here: files
  'POST /files/files': { implemented: true },
  'GET /files/files/{}': { implemented: true },
  'PATCH /files/files/{}': { implemented: true },
  'GET /files/files/{}/content': { implemented: true },
  'PUT /files/files/{}/content': { implemented: true },

  // Definition persistence does not implement job execution.
  'POST /jobDefinitions/definitions': { implemented: true },
  'GET /jobDefinitions/definitions/{}': { implemented: true },
  'POST /jobExecution/jobs': { implemented: false, reason: NEEDS_JOBS },
  'GET /jobExecution/jobs/{}': { implemented: false, reason: NEEDS_JOBS },
  'GET /jobExecution/jobs/{}/state': { implemented: false, reason: NEEDS_JOBS },

  // declined: contexts come from the seed, not from the launcher
  'GET /launcher/contexts': {
    implemented: false,
    reason:
      'The emulator answers compute contexts from its seed; the launcher list a client falls back to is not modelled, and nothing on the emulated path asks for it.'
  },

  // Default refusal, with an explicit host opt-in for a synthetic SYSJOBID.
  'GET /compute/sessions/{}/variables/{}': { implemented: true },

  // declined: the host owns the token port
  'POST /SASLogon/oauth/token': { implemented: false, reason: NEEDS_AUTH },

  // declared, not captured: the webout an application's service returns
  'GET /compute/sessions/{}/filerefs/_webout/content': { implemented: true }
}

/**
 * Refuse an overlay and a table that do not describe the same operations.
 *
 * Both directions, because each covers a different mistake:
 *
 * - an entry the table does not have is a claim about a call no client makes,
 *   which is what a stale entry becomes when an operation is retired;
 * - a row with no entry is a capture that landed without a decision. One loop
 *   is not enough: a re-capture that adds an operation would import cleanly and
 *   answer 501 at run time, and `dispatch.ts` says the overlay refuses exactly
 *   that.
 *
 * Called at import, and exported so the refusals themselves can be tested: a
 * check that only runs on import is a check nothing can pin.
 */
export const assertOverlayEntries = (
  overlay: Record<string, ViyaOverlayEntry>,
  operations: Array<{ id: string }> = VIYA_OPERATIONS
): void => {
  const known = new Set(operations.map((operation) => operation.id))

  for (const id of Object.keys(overlay))
    if (!known.has(id))
      throw new Error(
        `src/viya/overlay.ts names an operation the table does not have: ${id}. The table is generated from a capture, so an entry for an operation nobody observed is a claim about a call no client makes.`
      )

  for (const operation of operations)
    if (!(operation.id in overlay))
      throw new Error(
        `src/viya/overlay.ts has no decision for ${operation.id}. Every captured operation states whether this package implements it and, when it does not, the reason it does not: add \`{ implemented: false, reason: '...' }\` until a handler exists.`
      )
}

assertOverlayEntries(VIYA_OVERLAY)
