/**
 * The adapter's call surface, and what this package decides about each entry.
 *
 * Scope decision 3 of sasjs/server#665: the emulator answers the client's calls
 * and nothing else. This file is that statement in a form a check can read,
 * extracted from `@sasjs/adapter` 6.0.2 rather than from memory, and compared
 * with the adapter again by `npm run check:scope` (extraction) and by
 * `spec/viyaScope.spec.ts` (this file against the committed inventory).
 *
 * `decision: 'in'` means a host must answer it, and the table that lands next
 * has to cover it. `declined` means it is out of scope, with the reason that
 * goes into the 501 body if a client ever calls it here.
 */

export type SurfaceFamily =
  | 'sas9'
  | 'sasjs-api'
  | 'viya-auth'
  | 'viya-compute'
  | 'viya-files'
  | 'viya-folders'
  | 'viya-identity'
  | 'viya-jobs'

export interface SurfaceEntry {
  /** Where the client sends it; `{}` is one path segment. */
  path: string
  family: SurfaceFamily
  decision: 'in' | 'declined'
  /** What the emulator answers, or why it does not answer this at all. */
  reason: string
}

/** Pinned to the adapter the inventory was extracted from. */
export const SURFACE_ADAPTER_VERSION = '6.0.2'

export const SURFACE: SurfaceEntry[] = [
  // sas9
  {
    path: '/Public/example/deleteThis',
    family: 'sas9',
    decision: 'declined',
    reason: 'a path in a doc example or a default config value, not a call'
  },
  {
    path: '/Public/example/myFolder',
    family: 'sas9',
    decision: 'declined',
    reason: 'a path in a doc example or a default config value, not a call'
  },
  {
    path: '/Public/newDestination',
    family: 'sas9',
    decision: 'declined',
    reason: 'a path in a doc example or a default config value, not a call'
  },
  {
    path: '/Public/newDestination/myFolder',
    family: 'sas9',
    decision: 'declined',
    reason: 'a path in a doc example or a default config value, not a call'
  },
  {
    path: '/Public/seedapp',
    family: 'sas9',
    decision: 'declined',
    reason: 'a path in a doc example or a default config value, not a call'
  },
  {
    path: '/SASJobExecution',
    family: 'sas9',
    decision: 'declined',
    reason:
      'SAS 9 and SASjs surfaces: the emulator answers Viya, and the same client reaches these on an EBI deployment'
  },

  // viya-auth
  {
    path: '/SASLogon',
    family: 'viya-auth',
    decision: 'in',
    reason:
      'the auth flow the client speaks, and the reason the emulated paths cannot be renamed'
  },
  {
    path: '/SASLogon/home',
    family: 'viya-auth',
    decision: 'in',
    reason:
      'the auth flow the client speaks, and the reason the emulated paths cannot be renamed'
  },
  {
    path: '/SASLogon/login',
    family: 'viya-auth',
    decision: 'in',
    reason:
      'the auth flow the client speaks, and the reason the emulated paths cannot be renamed'
  },
  {
    path: '/SASLogon/login.do',
    family: 'viya-auth',
    decision: 'in',
    reason:
      'the auth flow the client speaks, and the reason the emulated paths cannot be renamed'
  },
  {
    path: '/SASLogon/logout',
    family: 'viya-auth',
    decision: 'in',
    reason:
      'the auth flow the client speaks, and the reason the emulated paths cannot be renamed'
  },
  {
    path: '/SASLogon/logout.do',
    family: 'viya-auth',
    decision: 'in',
    reason:
      'the auth flow the client speaks, and the reason the emulated paths cannot be renamed'
  },
  {
    path: '/SASLogon/oauth/authorize',
    family: 'viya-auth',
    decision: 'in',
    reason:
      'the auth flow the client speaks, and the reason the emulated paths cannot be renamed'
  },
  {
    path: '/SASLogon/oauth/token',
    family: 'viya-auth',
    decision: 'in',
    reason:
      'the auth flow the client speaks, and the reason the emulated paths cannot be renamed'
  },

  // sas9
  {
    path: '/SASStoredProcess',
    family: 'sas9',
    decision: 'declined',
    reason:
      'SAS 9 and SASjs surfaces: the emulator answers Viya, and the same client reaches these on an EBI deployment'
  },
  {
    path: '/SASStoredProcess/do',
    family: 'sas9',
    decision: 'declined',
    reason:
      'SAS 9 and SASjs surfaces: the emulator answers Viya, and the same client reaches these on an EBI deployment'
  },
  {
    path: '/SASStoredProcess/j_spring_cas_security_check',
    family: 'sas9',
    decision: 'declined',
    reason:
      'SAS 9 and SASjs surfaces: the emulator answers Viya, and the same client reaches these on an EBI deployment'
  },

  // sasjs-api
  {
    path: '/SASjsApi',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },
  {
    path: '/SASjsApi/{}',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },

  // sas9
  {
    path: '/User Folders/{}/My Folder/sasjs/runner',
    family: 'sas9',
    decision: 'declined',
    reason:
      'SAS 9 and SASjs surfaces: the emulator answers Viya, and the same client reaches these on an EBI deployment'
  },

  // sasjs-api
  {
    path: '/api',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },
  {
    path: '/api/stp/execute',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },
  {
    path: '/auth/refresh',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },
  {
    path: '/auth/token',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },
  {
    path: '/code/execute',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },

  // viya-compute
  {
    path: '/compute/contexts',
    family: 'viya-compute',
    decision: 'in',
    reason:
      'contexts, sessions, jobs and the webout fileref, which the emulator backs with SessionService and RuntimeService'
  },
  {
    path: '/compute/contexts/{}',
    family: 'viya-compute',
    decision: 'in',
    reason:
      'contexts, sessions, jobs and the webout fileref, which the emulator backs with SessionService and RuntimeService'
  },
  {
    path: '/compute/contexts/{}/sessions',
    family: 'viya-compute',
    decision: 'in',
    reason:
      'contexts, sessions, jobs and the webout fileref, which the emulator backs with SessionService and RuntimeService'
  },
  {
    path: '/compute/sessions/{}',
    family: 'viya-compute',
    decision: 'in',
    reason:
      'contexts, sessions, jobs and the webout fileref, which the emulator backs with SessionService and RuntimeService'
  },
  {
    path: '/compute/sessions/{}/filerefs/_webout/content',
    family: 'viya-compute',
    decision: 'in',
    reason:
      'contexts, sessions, jobs and the webout fileref, which the emulator backs with SessionService and RuntimeService'
  },
  {
    path: '/compute/sessions/{}/jobs',
    family: 'viya-compute',
    decision: 'in',
    reason:
      'contexts, sessions, jobs and the webout fileref, which the emulator backs with SessionService and RuntimeService'
  },
  {
    path: '/compute/sessions/{}/jobs/{}',
    family: 'viya-compute',
    decision: 'in',
    reason:
      'contexts, sessions, jobs and the webout fileref, which the emulator backs with SessionService and RuntimeService'
  },
  {
    path: '/compute/sessions/{}/variables/{}',
    family: 'viya-compute',
    decision: 'in',
    reason:
      'contexts, sessions, jobs and the webout fileref, which the emulator backs with SessionService and RuntimeService'
  },

  // viya-files
  {
    path: '/content',
    family: 'viya-files',
    decision: 'declined',
    reason:
      'not a route: a suffix the client appends to a file or log URI, which is why the file-content and job-log entries above carry it'
  },

  // sasjs-api
  {
    path: '/drive/deploy',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },
  {
    path: '/drive/deploy/upload',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },

  // viya-files
  {
    path: '/files/files',
    family: 'viya-files',
    decision: 'in',
    reason:
      'file create, read and replace, which the emulator backs with DriveService'
  },
  {
    path: '/files/files/{}',
    family: 'viya-files',
    decision: 'in',
    reason:
      'file create, read and replace, which the emulator backs with DriveService'
  },

  // viya-folders
  {
    path: '/folders/folders',
    family: 'viya-folders',
    decision: 'in',
    reason: 'content structure, which the emulator backs with DriveService'
  },
  {
    path: '/folders/folders/@item',
    family: 'viya-folders',
    decision: 'in',
    reason: 'content structure, which the emulator backs with DriveService'
  },
  {
    path: '/folders/folders/@myRecycleBin',
    family: 'viya-folders',
    decision: 'in',
    reason: 'content structure, which the emulator backs with DriveService'
  },
  {
    path: '/folders/folders/{}',
    family: 'viya-folders',
    decision: 'in',
    reason: 'content structure, which the emulator backs with DriveService'
  },
  {
    path: '/folders/folders/{}/members',
    family: 'viya-folders',
    decision: 'in',
    reason: 'content structure, which the emulator backs with DriveService'
  },

  // viya-identity
  {
    path: '/identities/users/@currentUser',
    family: 'viya-identity',
    decision: 'in',
    reason: 'who the caller is; every session and folder answer is scoped to it'
  },

  // viya-jobs
  {
    path: '/jobDefinitions/definitions',
    family: 'viya-jobs',
    decision: 'in',
    reason: 'the job path a deployed service runs through'
  },
  {
    path: '/jobExecution/jobs',
    family: 'viya-jobs',
    decision: 'in',
    reason: 'the job path a deployed service runs through'
  },
  {
    path: '/jobExecution/jobs/{}',
    family: 'viya-jobs',
    decision: 'in',
    reason: 'the job path a deployed service runs through'
  },

  // viya-compute
  {
    path: '/launcher/contexts',
    family: 'viya-compute',
    decision: 'in',
    reason:
      'contexts, sessions, jobs and the webout fileref, which the emulator backs with SessionService and RuntimeService'
  },

  // viya-files
  {
    path: '/log',
    family: 'viya-files',
    decision: 'declined',
    reason:
      'not a route: a suffix the client appends to a file or log URI, which is why the file-content and job-log entries above carry it'
  },

  // viya-auth
  {
    path: '/oauth/clients/{}',
    family: 'viya-auth',
    decision: 'declined',
    reason:
      'client registration is an identity-provider admin action; the emulated estate accepts the public `sas.cli` client and mints its own tokens'
  },

  // sasjs-api
  {
    path: '/session/{}',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },
  {
    path: '/session/{}/log',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },
  {
    path: '/session/{}/state',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },
  {
    path: '/stp/execute',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },
  {
    path: '/stp/trigger',
    family: 'sasjs-api',
    decision: 'declined',
    reason:
      "the SASjs API surface, answered by the server's own registered routes, not by a Viya-shaped one"
  },

  // viya-files
  {
    path: '/types/types',
    family: 'viya-files',
    decision: 'in',
    reason:
      'read before every file create, to find the type definition for the extension'
  }
]
