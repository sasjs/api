/**
 * What the OpenAPI document cannot say.
 *
 * The generated table states the route's shape - method, path, parameters,
 * documented responses. This file adds the three things a document has no room
 * for, each of which a host or a test needs:
 *
 *   - the body a response carries, because a client keys on `{"status":
 *     "success"}` and on the wording of a refusal, not on a status alone;
 *   - which capability the route needs, so a host can answer 501 with a reason
 *     instead of 404 with none;
 *   - whether this package implements it yet, so "not done" is visible.
 *
 * `correction` is the fourth: where sasjs/server's own document and its
 * implementation disagree, the entry records which one this package follows.
 * Those are real, not hypothetical - the drive's create and replace routes are
 * documented 403 and throw 409/404 - and they are why the table is generated
 * but the statuses are pinned by the corpus rather than trusted from the spec.
 */
import type { Capability, HttpMethod } from '../types.js'

export interface RouteOverlay {
  capabilities?: Capability[]
  implemented?: boolean
  /** The body the operation sends with a status, where a client keys on it. */
  responses?: Record<number, unknown>
  /** Where the published document and the implementation disagree. */
  correction?: string
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
  'GET /SASjsApi/drive/file': {
    implemented: true,
    responses: { 200: '<the file contents>' },
    correction:
      'documented as 204, because the controller writes the response itself rather than returning a body'
  },
  'POST /SASjsApi/drive/file': {
    implemented: true,
    responses: { 200: success, 409: { message: 'File already exists.' } },
    correction:
      'documented as 403 for a path that is taken; DriveController.saveFile throws 409'
  },
  'PATCH /SASjsApi/drive/file': {
    implemented: true,
    responses: { 200: success, 404: { message: `File doesn't exist.` } },
    correction:
      'documented as 403 for a path that is missing; DriveController.updateFile throws 404'
  },
  'DELETE /SASjsApi/drive/file': {
    implemented: true,
    responses: { 200: success, 404: { message: `File doesn't exist.` } }
  },
  'GET /SASjsApi/drive/folder': {
    implemented: true,
    responses: { 200: { files: [], folders: [] } }
  },
  'POST /SASjsApi/drive/folder': {
    implemented: true,
    responses: { 200: success, 409: { message: 'Folder already exists.' } }
  },
  'DELETE /SASjsApi/drive/folder': {
    implemented: true,
    responses: { 200: success, 404: { message: `Folder doesn't exist.` } }
  },
  'POST /SASjsApi/drive/rename': {
    implemented: true,
    responses: {
      200: success,
      409: { message: 'File with new name already exists.' },
      404: { message: 'No file/folder found for provided path.' }
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
