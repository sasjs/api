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
    id: 'GET /compute/sessions/{}/jobs/{}/log',
    method: 'GET',
    path: '/compute/sessions/{}/jobs/{}/log',
    steps: [],
    statuses: [200, 400, 404],
    queries: ['start', 'limit'],
    request: { queries: ['start', 'limit'], body: undefined },
    shape: undefined,
    declared:
      'The CLI follows the job log link directly and pages it; the adapter capture reads the different /log/content operation. SAS Compute documents this as a collection of log line objects.'
  },
  {
    id: 'GET /compute/sessions/{}/filerefs/_webout/content',
    method: 'GET',
    path: '/compute/sessions/{}/filerefs/_webout/content',
    steps: [],
    // what this emulator answers, not what an estate did: 200 with the webout,
    // 404 when no program has run in the session
    statuses: [200, 404],
    queries: [],
    request: { queries: [], body: undefined },
    // the body is the program's `_webout`, which is whatever the program wrote:
    // there is no JSON shape to record
    shape: undefined,
    declared:
      'The adapter fetches this only when a run expects a webout (`expectWebout`), and the recording pass submits a `%put` and reads the log instead. Without it an application cannot receive the data its service returns, so the emulator answers it from the job it just ran.'
  },

  // The application's own identity reads. No capture describes these at all: the
  // recorder drives the client the adapter is, and Data Controller's group, user
  // and deploy screens call the identity service from the browser instead. That
  // is why they are declared rather than recorded, and why the scope they belong
  // to is stated in `src/viya/appSurface.ts`.
  {
    id: 'GET /identities/groups',
    method: 'GET',
    path: '/identities/groups',
    steps: [],
    statuses: [200],
    queries: ['sortBy', 'limit', 'start'],
    request: { queries: ['sortBy', 'limit', 'start'], body: undefined },
    // a collection of groups, whose own shape Viya publishes rather than an
    // estate recording supplying it
    shape: undefined,
    declared:
      'The application fetches the group list twice on its deploy screen - for the admin-group dropdown and, filtered, for the caller own groups - and aborts the wizard when that read fails. The adapter never calls it, so no recording pass reaches it.'
  },
  {
    id: 'GET /identities/groups/{}/members',
    method: 'GET',
    path: '/identities/groups/{}/members',
    steps: [],
    statuses: [200, 404],
    queries: ['limit'],
    request: { queries: ['limit'], body: undefined },
    shape: undefined,
    declared:
      'The group screen lists the accounts that hold a group, following the members link the group list advertises. The adapter has no identity route beyond the caller, so a capture driven by it cannot reach this one.'
  },
  {
    id: 'GET /identities/users',
    method: 'GET',
    path: '/identities/users',
    steps: [],
    statuses: [200],
    queries: ['limit', 'start'],
    request: { queries: ['limit', 'start'], body: undefined },
    shape: undefined,
    declared:
      'The user screen lists the estate accounts. The adapter does not offer an account list and never requests one, so the recording pass has no way to observe it.'
  },
  {
    id: 'GET /identities/users/{}',
    method: 'GET',
    path: '/identities/users/{}',
    steps: [],
    statuses: [200, 404],
    queries: [],
    request: { queries: [], body: undefined },
    shape: undefined,
    declared:
      'The user screen reads one account from the id the list returned, for the profile above the memberships. The adapter asks only about the caller, which is a different operation with its own row.'
  },
  {
    id: 'GET /identities/users/@currentUser/memberships',
    method: 'GET',
    path: '/identities/users/@currentUser/memberships',
    steps: [],
    statuses: [200],
    queries: ['limit', 'start'],
    request: { queries: ['limit', 'start'], body: undefined },
    shape: undefined,
    declared:
      'The deploy screen filters the admin-group list to the groups the caller belongs to, and shows every group when this read fails. The adapter reads the caller itself but never the caller memberships.'
  },
  {
    id: 'GET /identities/users/{}/memberships',
    method: 'GET',
    path: '/identities/users/{}/memberships',
    steps: [],
    statuses: [200, 401],
    queries: ['limit', 'start'],
    request: { queries: ['limit', 'start'], body: undefined },
    shape: undefined,
    declared:
      'The user screen lists the groups any account holds, addressed by the id the list returned. It is the same answer as the caller own memberships for one id, and the adapter asks for neither.'
  },
  {
    id: 'GET /identities/users/{}/avatar/content',
    method: 'GET',
    path: '/identities/users/{}/avatar/content',
    steps: [],
    statuses: [404],
    queries: [],
    request: { queries: [], body: undefined },
    // the body is an image when an estate holds one: there is no JSON shape
    shape: undefined,
    declared:
      'The header renders the caller avatar from this URL, and an estate whose identity carries no avatar answers 404 so the client falls back to its own image. The adapter has no avatar read.'
  },
  {
    id: 'GET /compute/contexts/{}',
    method: 'GET',
    path: '/compute/contexts/{}',
    steps: [],
    statuses: [200, 404],
    queries: [],
    request: { queries: [], body: undefined },
    shape: undefined,
    declared:
      'The deploy screen reads each context in full, because the list view carries neither the batch identity nor the reuse setting it filters on. The capture recorded the list only, so the read it follows with is stated here.'
  }
]

/** Every operation the emulator answers: what an estate did, plus what it must. */
export const VIYA_OPERATIONS: ViyaOperation[] = [...VIYA_TABLE, ...DECLARED]
