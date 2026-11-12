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
  DeployFileEncoding,
  DeployLimits,
  DeployMeasurements,
  DeployMember,
  DeployOptions,
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

// the client's call surface, and this package's decision about each entry: a
// host that refuses an out-of-scope path reads the same statement the guard does
export { SURFACE, SURFACE_ADAPTER_VERSION } from './viya/surface.js'
export type { SurfaceEntry, SurfaceFamily } from './viya/surface.js'
export { VIYA_TABLE } from './viya/table.js'
export type { ViyaOperation } from './viya/table.js'
export { UNRECORDED } from './viya/unrecorded.js'
export type { UnrecordedOperation } from './viya/unrecorded.js'
export {
  EMULATED_HEADER,
  EMULATED_HEADER_VALUE,
  VIYA_CAPTURED_AT,
  VIYA_TARGET_VERSION,
  emulatedHeaders
} from './viya/version.js'
export { dispatchViya, findViyaOperation } from './viya/dispatch.js'
export type { ViyaMatch, ViyaResponse } from './viya/dispatch.js'
export { VIYA_OVERLAY } from './viya/overlay.js'
export type { ViyaOverlayEntry } from './viya/overlay.js'
export { VIYA_HANDLERS } from './viya/service.js'
export { VIYA_CORPUS } from './corpus/viya/operations.js'
export type { ViyaCase } from './corpus/viya/operations.js'
export { dispatch, HANDLED_ROUTES } from './host/dispatch.js'

// a host gating its own middleware reads the same decision the inventory reports
export * from './identity/routeAccess.js'
export type { ApiRequest, ApiResponse, Services } from './host/dispatch.js'
export { createIdentityService } from './identity/service.js'
export { createRecordService, sanitiseDisplayName } from './identity/records.js'
export { CODE_CORPUS } from './corpus/code.js'
export { INFO_CORPUS } from './corpus/info.js'
export { ADMIN_CORPUS } from './corpus/admin.js'
export { AUTH_CONFIG_CORPUS } from './corpus/authconfig.js'
export { DIRECTORY_CORPUS } from './corpus/directory.js'
export { HOME_CORPUS } from './corpus/home.js'
export {
  BUNDLE_NAME,
  NO_WEB_BUILD,
  createHomeService,
  withBundleVersion
} from './home/service.js'
export type { HomeService, WebPage } from './home/service.js'
export {
  BROWSER_INFO,
  createInfoService,
  normaliseInfo
} from './info/service.js'
export type { InfoResponse, InfoService } from './info/service.js'
export {
  createAuthConfigService,
  normaliseAuthConfig
} from './authconfig/service.js'
export type {
  AuthConfig,
  AuthConfigResponse,
  AuthConfigService,
  LdapProviderConfig,
  OidcProviderConfig
} from './authconfig/service.js'
export {
  DEFAULT_LOG_LINES,
  MAX_LOG_LINES,
  checkLogFileName,
  createAdminService,
  logLines,
  normaliseDiagnostics,
  normaliseLogFiles
} from './admin/service.js'
export type {
  AdminReports,
  AdminService,
  BuildInfo,
  DiagnosticsResponse,
  FilesystemUsage,
  FolderUsage,
  LogFileInfo,
  LogFolderSummary,
  LogTail,
  MemoryDetails,
  ServerDetails
} from './admin/service.js'
export { createDirectoryService } from './directory/service.js'
export type {
  DirectoryGroup,
  DirectoryService,
  DirectoryServiceOptions,
  DirectorySource,
  DirectoryStore,
  DirectorySyncResult,
  DirectoryUser
} from './directory/service.js'
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
export { DEPLOY_CORPUS } from './corpus/deploy.js'
export { APP_CORPUS } from './corpus/app.js'
export { SESSION_CORPUS } from './corpus/session.js'
export { createSessionService } from './session/service.js'
export type {
  CallerDirectory,
  HostSession,
  SessionArtifact,
  SessionHost,
  SessionService,
  SessionStateResponse,
  SessionStateValue,
  SessionSummary
} from './session/service.js'
export { DEFAULT_SESSIONS, MemorySessionHost } from './session/memory-host.js'
export { CODE_DEBUG, createRuntimeService } from './runtime/service.js'
export { DOCUMENTED_RUN_TIMES } from './runtime/runTimes.js'
export type {
  ProgramSource,
  RunOutcome,
  RunRequest,
  RunnerSession,
  RuntimeRequest,
  RuntimeService,
  RuntimeServiceOptions,
  SessionRunner,
  TriggerResponse
} from './runtime/service.js'
export {
  programNotFound,
  resolveProgram,
  runTimeOfPath
} from './runtime/program.js'
export type { ProgramDeps, ProgramResolution } from './runtime/program.js'
export { MemorySessionRunner } from './runtime/memory-runner.js'
export type { MemoryRunnerOptions } from './runtime/memory-runner.js'
export { RUNTIME_CORPUS } from './corpus/runtime.js'
export {
  RECORD_CORPUS,
  ADMIN_SIGNED_IN,
  PROVIDER_MANAGED
} from './corpus/records.js'
export type { CorpusCase } from './corpus/drive.js'
export { runCase, servicesFor } from './corpus/runner.js'
export type { CaseResult } from './corpus/runner.js'

export {
  appSummary,
  checkPublishRequest,
  createAppStreamService,
  defaultAppName,
  MemoryAppStreamStore
} from './appstream/service.js'
export type {
  AppStreamEntry,
  AppStreamService,
  AppStreamStore,
  CheckedPublish,
  PublishAppRequest
} from './appstream/service.js'
export {
  APP_MANIFEST,
  parseAppManifest,
  publishRequestFor,
  splitAppBundle
} from './appstream/bundle.js'
export type {
  AppBundle,
  AppManifest,
  DeployPublish
} from './appstream/bundle.js'
export {
  APP_STREAM_INDEX,
  createDriveAppStreamStore
} from './appstream/store.js'
export {
  DEFAULT_APP_PATH,
  NO_SUCH_APP,
  cacheControlFor,
  contentTypeFor,
  createAppStreamWebService,
  escapeHtml
} from './appstream/web.js'
export type {
  AppFilter,
  AppStreamApp,
  AppStreamPage,
  AppStreamRequest,
  AppStreamWebOptions,
  AppStreamWebService
} from './appstream/web.js'
export { isAppId, newAppId, normaliseAppLoc } from './appstream/identity.js'
