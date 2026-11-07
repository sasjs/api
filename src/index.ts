/**
 * `@sasjs/api` - the SASjs Server API described once.
 *
 * The package has three parts, and each is usable on its own:
 *
 *   - the route table (`ROUTES`, `findRoute`), generated from sasjs/server's
 *     published OpenAPI document and amended by a reviewed overlay;
 *   - the services (`createDriveService`), which are the API's decisions over
 *     storage a host supplies;
 *   - the conformance corpus (`DRIVE_CORPUS`, `runCase`), which is what "the
 *     same API" means when a test has to check it.
 *
 * It imports no runtime on purpose: the same build runs in an Express server and
 * in a service worker, so anything node-shaped is a store a host passes in.
 */
export * from './types.js'
export {
  normaliseDrivePath,
  hasBlockedExtension,
  dirname,
  basename,
  isRoot
} from './drive/paths.js'
export { createDriveService } from './drive/service.js'
export {
  DEPLOY_LIMITS,
  DEPLOY_PAYLOAD_BYTES,
  DEPLOY_SUCCESS,
  checkDeployTree,
  decodeBase64,
  deployTree,
  isDeployTree,
  measureDeployTree
} from './drive/deploy.js'
export type {
  DeployLimits,
  DeployMeasurements,
  DeployMember,
  DeployRefusal,
  DeployTree
} from './drive/deploy.js'
export type {
  DriveService,
  DriveResult,
  DriveListing,
  DriveFile,
  DriveTree
} from './drive/service.js'
export { MemoryDriveStore } from './drive/memory-store.js'
export { ROUTES, routeById, findRoute } from './routes/index.js'
export type { RouteMatch } from './routes/index.js'
export { OVERLAY, TAG_CAPABILITIES } from './routes/overlay.js'
export type { RouteOverlay } from './routes/overlay.js'
export { dispatch, HANDLED_ROUTES } from './host/dispatch.js'

// a host gating its own middleware reads the same decision the inventory reports
export * from './identity/routeAccess.js'
export type { ApiRequest, ApiResponse, Services } from './host/dispatch.js'
export { createIdentityService } from './identity/service.js'
export { createRecordService, sanitiseDisplayName } from './identity/records.js'
export { CODE_CORPUS } from './corpus/code.js'
export type {
  AuthorizedRoutesResponse,
  GroupDetailsResponse,
  GroupResponse,
  PermissionResponse,
  RecordServiceOptions,
  RecordService,
  UserDetailsResponse,
  UserResponse
} from './identity/records.js'
export type {
  IdentityService,
  LoginResult,
  SessionResult
} from './identity/service.js'
export { MemoryIdentityStore } from './identity/memory-store.js'
export {
  DEFAULT_IDENTITY,
  IDENTITY_FORMAT,
  parseIdentity
} from './identity/fixture.js'
export type {
  IdentityFixture,
  IdentityFixtureClient,
  IdentityFixtureCode,
  IdentityFixtureGroup,
  IdentityFixturePermission,
  IdentityFixtureToken,
  IdentityFixtureUser
} from './identity/fixture.js'
export type {
  IdentityClient,
  IdentityClientRecord,
  IdentityGroupRecord,
  IdentityPermissionRecord,
  IdentityStore,
  IdentityUser,
  IdentityUserRecord,
  NewGroup,
  NewPermission,
  NewUser,
  Subject,
  TokenPair,
  UserChange
} from './identity/types.js'
export { DRIVE_CORPUS } from './corpus/drive.js'
export { IDENTITY_CORPUS } from './corpus/identity.js'
export { SESSION_CORPUS } from './corpus/session.js'
export {
  RECORD_CORPUS,
  ADMIN_SIGNED_IN,
  PROVIDER_MANAGED
} from './corpus/records.js'
export type { CorpusCase } from './corpus/drive.js'
export { runCase, servicesFor } from './corpus/runner.js'
export type { CaseResult } from './corpus/runner.js'
