/**
 * What the OpenAPI document cannot say.
 *
 * The generated table states the route's shape - method, path, parameters,
 * documented responses. This file adds the three things a document has no room
 * for, each of which a host or a test needs:
 *
 *   - the body a response carries, because a client keys on `{"status":
 *     "success"}` and on the wording of a refusal, not on a status alone. A
 *     refusal's body is the message as a plain string: the drive routes answer
 *     `res.status(code).send(err.message)`, and sasjs/server's own suite asserts
 *     `res.text`. A host renders that in its own transport - a text body on the
 *     server, `text(...)` in the worker - and never wraps it in an envelope the
 *     server does not send;
 *   - which capability the route needs, so a host can answer 501 with a reason
 *     instead of 404 with none;
 *   - whether this package implements it and, when it does not, what the
 *     operation is waiting on.
 *
 * EVERY operation in the document has an entry, and the type carries the rule:
 * `implemented: true`, or `implemented: false` with the `reason` it is not. An
 * operation with no entry is a build failure (`src/routes/index.ts`), because
 * silence is indistinguishable from "nobody has looked at this yet" - which is
 * the state this file exists to remove. The reason is also what a 501 carries
 * to whoever asked (`src/host/dispatch.ts`), so the answer names the dependency
 * rather than the absence.
 *
 * The statuses come from the document, and an overlay body is attached to the
 * status it belongs to: naming a status the document does not state is a build
 * failure, not a way to describe a divergence. A divergence between the document
 * and the code is a bug in one of them, corrected at source in `sasjs/server` and
 * re-vendored here.
 */
import type { Capability, HttpMethod } from '../types.js'

/** The annotations both states of an entry can carry. */
interface OverlayFields {
  capabilities?: Capability[]
  /**
   * Statuses the document states that this package cannot send because they are
   * the host's to send: an account lockout is the host's login limiter, a
   * provider failure is its identity provider, a session-store failure is its
   * session middleware. They stay in the document - a client still receives
   * them - and are excluded from the corpus parity check, whose other side is
   * what the package answers. The host's own suite pins them.
   */
  hostResponses?: number[]
  /**
   * The body the operation sends with a status, where a client keys on it. The
   * statuses come from the document; this only annotates them.
   */
  responses?: Record<number, unknown>
}

/**
 * One operation's decision: carried here, or carried by the host.
 *
 * A union rather than an optional field, so a route marked unimplemented
 * without saying why does not compile. The reason is the point of the entry -
 * "not done yet" on its own tells a reader nothing they can act on.
 */
export type RouteOverlay = OverlayFields &
  ({ implemented: true } | { implemented: false; reason: string })

/** The default capability for each tag, overridden per route where it differs. */
export const TAG_CAPABILITIES: Record<string, Capability[]> = {
  Drive: ['storage'],
  STP: ['runtime', 'storage'],
  Code: ['runtime'],
  Session: ['runtime'],
  Info: [],
  Admin: ['storage'],
  Auth: ['identity'],
  'Auth Config': ['identity'],
  User: ['identity'],
  Group: ['identity'],
  Permission: ['identity'],
  Client: ['identity'],
  Web: ['identity']
}

/**
 * Why a block of operations is not implemented here.
 *
 * One per dependency rather than one per route: the reason states what the
 * operation waits on, and thirty copies of the same sentence would say the same
 * thing thirty times.
 */
const IDENTITY_RECORDS =
  'The identity service answers the sign-in flow. User, group, permission rule, client and provider records need read and write methods on the same store, which this package does not have yet.'

const EDITOR =
  'Linting and formatting come from @sasjs/lint, which this package does not depend on. They land with the code routes so an editor has one wiring.'

const RUNTIME =
  'Starting a program needs a runtime port, which this package does not have: a host decides which languages it holds, and answers this itself until then.'

const SESSION_RECORD =
  "A triggered session's record, log, output and state belong to the runtime that ran the program, and this package has no runtime port."

const HOST_CONFIG =
  "The body is the host's own configuration - ports, run times and providers - which a mock states for itself and this package cannot know."

const PERMISSIONS =
  "The route inventory is the host's permission model, which this package does not hold."

const HOST_OWNED =
  "The host owns this report: it describes the host's own process and files, which a browser build has no equivalent of."

const WEB_BUNDLE =
  'The host serves its own web bundle; there is no API decision here for this package to answer.'

const DEPLOY_CAP =
  "Writing a whole tree in one request can exhaust the host's storage, so the deploy routes land with the size cap that bounds it."

const UNPUBLISH =
  'Unpublishing inverts the deploy route, so the two land together.'

const success = { status: 'success' }

const user = {
  uid: '',
  username: '',
  displayName: '',
  isAdmin: false,
  needsToUpdatePassword: false
}

export const OVERLAY: Record<string, RouteOverlay> = {
  // Web - the sign-in pages the identity service answers, and the bundle itself
  'GET /': { implemented: false, reason: WEB_BUNDLE },
  'POST /SASLogon/login': {
    implemented: true,
    // The lockout and the provider failure are answered before the package is
    // consulted (routes/web/web.ts in sasjs/server).
    hostResponses: [429, 500],
    responses: { 200: { loggedIn: true, user } }
  },
  'POST /SASLogon/authorize': {
    implemented: true,
    responses: { 200: { code: '' } }
  },
  'GET /SASLogon/logout': {
    implemented: true,
    hostResponses: [500],
    responses: { 200: 'OK!' }
  },

  // Admin - the host's own process and files
  'GET /SASjsApi/admin/diagnostics': { implemented: false, reason: HOST_OWNED },
  'GET /SASjsApi/admin/logs': { implemented: false, reason: HOST_OWNED },
  'GET /SASjsApi/admin/logs/{fileName}': {
    implemented: false,
    reason: HOST_OWNED
  },

  // Auth - the token flow, plus a password change the identity store cannot write
  'POST /SASjsApi/auth/token': {
    implemented: true,
    responses: { 200: { accessToken: '', refreshToken: '' } }
  },
  'POST /SASjsApi/auth/refresh': {
    implemented: true,
    responses: { 200: { accessToken: '', refreshToken: '' } }
  },
  'POST /SASjsApi/auth/logout': { implemented: true },
  'PATCH /SASjsApi/auth/updatePassword': {
    implemented: false,
    reason: IDENTITY_RECORDS
  },

  // Auth Config - the providers a host was started with, and an LDAP import
  'GET /SASjsApi/authConfig': { implemented: false, reason: HOST_CONFIG },
  'POST /SASjsApi/authConfig/synchroniseWithLDAP': {
    implemented: false,
    reason: IDENTITY_RECORDS
  },

  // Client - the OAuth clients the identity store already holds for sign-in
  'GET /SASjsApi/client': { implemented: false, reason: IDENTITY_RECORDS },
  'POST /SASjsApi/client': { implemented: false, reason: IDENTITY_RECORDS },

  // Code - the editor's three calls, and the runtime one
  'POST /SASjsApi/code/execute': { implemented: false, reason: RUNTIME },
  'POST /SASjsApi/code/trigger': { implemented: false, reason: RUNTIME },
  'POST /SASjsApi/code/lint': { implemented: false, reason: EDITOR },
  'POST /SASjsApi/code/format': { implemented: false, reason: EDITOR },

  // Drive - the file and folder rules, and the three deploy routes
  // The body is the file itself, so there is nothing to annotate
  'GET /SASjsApi/drive/file': { implemented: true },
  'POST /SASjsApi/drive/file': {
    implemented: true,
    responses: { 200: success, 409: 'File already exists.' }
  },
  'PATCH /SASjsApi/drive/file': {
    implemented: true,
    responses: { 200: success, 404: `File doesn't exist.` }
  },
  'DELETE /SASjsApi/drive/file': {
    implemented: true,
    responses: { 200: success, 404: `File doesn't exist.` }
  },
  'GET /SASjsApi/drive/folder': {
    implemented: true,
    responses: { 200: { files: [], folders: [] } }
  },
  'POST /SASjsApi/drive/folder': {
    implemented: true,
    responses: { 200: success, 409: 'Folder already exists.' }
  },
  'DELETE /SASjsApi/drive/folder': {
    implemented: true,
    responses: { 200: success, 404: `Folder doesn't exist.` }
  },
  'POST /SASjsApi/drive/rename': {
    implemented: true,
    responses: {
      200: success,
      409: 'File with new name already exists.',
      404: 'No file/folder found for provided path.'
    }
  },
  'GET /SASjsApi/drive/filetree': {
    implemented: true,
    responses: { 200: { status: 'success', tree: {} } }
  },
  'POST /SASjsApi/drive/deploy': { implemented: false, reason: DEPLOY_CAP },
  'POST /SASjsApi/drive/deploy/upload': {
    implemented: false,
    reason: DEPLOY_CAP
  },
  // `404` is a pair - the registry name and the appLoc it was published from -
  // that matches no entry, and the drive's content is deliberately left alone.
  'DELETE /SASjsApi/drive/deploy': {
    implemented: false,
    reason: UNPUBLISH
  },

  // Group - members and the groups themselves
  'GET /SASjsApi/group': { implemented: false, reason: IDENTITY_RECORDS },
  'GET /SASjsApi/group/{uid}': { implemented: false, reason: IDENTITY_RECORDS },
  'GET /SASjsApi/group/by/groupname/{name}': {
    implemented: false,
    reason: IDENTITY_RECORDS
  },
  'POST /SASjsApi/group': { implemented: false, reason: IDENTITY_RECORDS },
  'POST /SASjsApi/group/{groupUid}/{userUid}': {
    implemented: false,
    reason: IDENTITY_RECORDS
  },
  'DELETE /SASjsApi/group/{groupUid}/{userUid}': {
    implemented: false,
    reason: IDENTITY_RECORDS
  },
  'DELETE /SASjsApi/group/{uid}': {
    implemented: false,
    reason: IDENTITY_RECORDS
  },

  // Info - what the host is, and what this caller may use
  'GET /SASjsApi/info': { implemented: false, reason: HOST_CONFIG },
  'GET /SASjsApi/info/authorizedRoutes': {
    implemented: false,
    // the route inventory reports what the CALLER may use, so it needs an
    // identity even though the rest of the Info tag needs nothing
    capabilities: ['identity'],
    reason: PERMISSIONS
  },
  'GET /SASjsApi/info/myAuthorizedRoutes': {
    implemented: false,
    capabilities: ['identity'],
    reason: PERMISSIONS
  },

  // Permission - the rules the inventory above is derived from
  'GET /SASjsApi/permission': { implemented: false, reason: IDENTITY_RECORDS },
  'POST /SASjsApi/permission': { implemented: false, reason: IDENTITY_RECORDS },
  'PATCH /SASjsApi/permission/{uid}': {
    implemented: false,
    reason: IDENTITY_RECORDS
  },
  'DELETE /SASjsApi/permission/{uid}': {
    implemented: false,
    reason: IDENTITY_RECORDS
  },

  // Session - the caller's own session, then the record behind a triggered one
  'GET /SASjsApi/session': {
    implemented: true,
    responses: { 200: user }
  },
  'GET /SASjsApi/session/{sessionId}': {
    implemented: false,
    reason: SESSION_RECORD
  },
  'GET /SASjsApi/session/{sessionId}/log': {
    implemented: false,
    reason: SESSION_RECORD
  },
  'GET /SASjsApi/session/{sessionId}/output': {
    implemented: false,
    reason: SESSION_RECORD
  },
  'GET /SASjsApi/session/{sessionId}/state': {
    implemented: false,
    reason: SESSION_RECORD
  },

  // STP - a stored program, on the runtime port
  'GET /SASjsApi/stp/execute': { implemented: false, reason: RUNTIME },
  'POST /SASjsApi/stp/execute': { implemented: false, reason: RUNTIME },
  'POST /SASjsApi/stp/trigger': { implemented: false, reason: RUNTIME },

  // User - the accounts the identity store already holds for sign-in
  'GET /SASjsApi/user': { implemented: false, reason: IDENTITY_RECORDS },
  'GET /SASjsApi/user/{uid}': { implemented: false, reason: IDENTITY_RECORDS },
  'GET /SASjsApi/user/by/username/{username}': {
    implemented: false,
    reason: IDENTITY_RECORDS
  },
  'POST /SASjsApi/user': { implemented: false, reason: IDENTITY_RECORDS },
  'PATCH /SASjsApi/user/{uid}': {
    implemented: false,
    reason: IDENTITY_RECORDS
  },
  'PATCH /SASjsApi/user/by/username/{username}': {
    implemented: false,
    reason: IDENTITY_RECORDS
  },
  'DELETE /SASjsApi/user/{uid}': {
    implemented: false,
    reason: IDENTITY_RECORDS
  },
  'DELETE /SASjsApi/user/by/username/{username}': {
    implemented: false,
    reason: IDENTITY_RECORDS
  }
}

/** Every method the table may state, in the order a diff reads best. */
export const METHODS: HttpMethod[] = ['GET', 'POST', 'PATCH', 'DELETE', 'PUT']
