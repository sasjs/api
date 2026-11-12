/**
 * Operations the emulator must answer that no capture describes.
 *
 * The table is generated from what an estate answered, which is the right rule:
 * a row nobody observed is a claim about a call no client makes. But a client
 * does make some calls that no recording pass reaches, and an emulator that
 * cannot answer them is an emulator an application cannot run on. Those rows are
 * stated here, each with the reason it has no capture, and they pass through the
 * same overlay ratchet as a captured one - so a declared operation still needs a
 * decision about whether this package implements it.
 *
 * They are kept out of `src/viya/table.ts` because that file is generated: a
 * hand-written row in it would be deleted by the next `npm run sync:viya`, and a
 * generator that had to preserve hand edits would stop being a generator.
 */
import { VIYA_TABLE, type ViyaOperation } from './table.js'

/** A row, and why it is stated rather than recorded. */
export interface DeclaredOperation extends ViyaOperation {
  /** What no capture could show, and why the client still needs it. */
  declared: string
}

export const DECLARED: DeclaredOperation[] = [
  {
    id: 'GET /compute/sessions/{}/filerefs/_webout/content',
    method: 'GET',
    path: '/compute/sessions/{}/filerefs/_webout/content',
    steps: [],
    statuses: [200],
    queries: [],
    request: { queries: [], body: undefined },
    // the body is the program's `_webout`, which is whatever the program wrote:
    // there is no JSON shape to record
    shape: undefined,
    declared:
      'The adapter fetches this only when a run expects a webout (`expectWebout`), and the recording pass submits a `%put` and reads the log instead. Without it an application cannot receive the data its service returns, so the emulator answers it from the job it just ran.'
  }
]

/** Every operation the emulator answers: what an estate did, plus what it must. */
export const VIYA_OPERATIONS: ViyaOperation[] = [...VIYA_TABLE, ...DECLARED]
