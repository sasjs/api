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
import { VIYA_TABLE } from './table.js'

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

export const VIYA_OVERLAY: Record<string, ViyaOverlayEntry> = {
  // answered here
  'POST /folders/folders': { implemented: true },
  'GET /folders/folders/{}': { implemented: true },
  'PATCH /folders/folders/{}': { implemented: true },
  'GET /folders/folders/{}/members': { implemented: true },
  'GET /folders/folders/@item': { implemented: true },
  'GET /folders/folders/@myRecycleBin': { implemented: true },
  'GET /identities/users/@currentUser': { implemented: true },
  'GET /types/types': { implemented: true },

  // declined: the session and file ports
  'GET /compute/contexts': { implemented: true },
  'POST /compute/contexts/{}/sessions': { implemented: true },
  'DELETE /compute/sessions/{}': { implemented: true },
  'POST /compute/sessions/{}/jobs': { implemented: true },
  'GET /compute/sessions/{}/jobs/{}': { implemented: true },
  'GET /compute/sessions/{}/jobs/{}/log/content': { implemented: true },
  'GET /compute/sessions/{}/jobs/{}/state': { implemented: true },
  'GET /compute/sessions/{}/state': { implemented: true },
  'POST /files/files': { implemented: true },
  'GET /files/files/{}': { implemented: true },
  'PATCH /files/files/{}': { implemented: true },
  'GET /files/files/{}/content': { implemented: true },
  'PUT /files/files/{}/content': { implemented: true },

  // declined: the host owns the token port
  'POST /SASLogon/oauth/token': { implemented: false, reason: NEEDS_AUTH }
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
  operations: Array<{ id: string }> = VIYA_TABLE
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
