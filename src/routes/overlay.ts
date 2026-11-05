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
 *   - whether this package implements it yet, so "not done" is visible.
 *
 * The statuses come from the document, and an overlay body is attached to the
 * status it belongs to: naming a status the document does not state is a build
 * failure, not a way to describe a divergence. A divergence between the document
 * and the code is a bug in one of them, corrected at source in `sasjs/server` and
 * re-vendored here.
 */
import type { Capability, HttpMethod } from '../types.js'

export interface RouteOverlay {
  capabilities?: Capability[]
  implemented?: boolean
  /**
   * The body the operation sends with a status, where a client keys on it. The
   * statuses come from the document; this only annotates them.
   */
  responses?: Record<number, unknown>
}

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

const success = { status: 'success' }

export const OVERLAY: Record<string, RouteOverlay> = {
  // the route inventory reports what the CALLER may use, so it needs an identity
  // even though the rest of the Info tag needs nothing
  'GET /SASjsApi/info/authorizedRoutes': { capabilities: ['identity'] },
  'GET /SASjsApi/info/myAuthorizedRoutes': { capabilities: ['identity'] },
  // the body is the file itself, so there is nothing to annotate
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
  // The two deploy routes write a whole tree in one request. They are the only
  // ones where a caller can exhaust the host's storage, so they carry a cap -
  // see the plan in sasjs/cli#1550 - and they are not implemented yet.
  'POST /SASjsApi/drive/deploy': {
    implemented: false
  },
  'POST /SASjsApi/drive/deploy/upload': {
    implemented: false
  }
}

/** Every method the table may state, in the order a diff reads best. */
export const METHODS: HttpMethod[] = ['GET', 'POST', 'PATCH', 'DELETE', 'PUT']
