/**
 * The application's call surface, and what this package decides about each entry.
 *
 * `src/viya/surface.ts` is the adapter's surface: what `@sasjs/adapter` measured
 * to build. It is not the whole story, because an application can call the
 * platform itself. Data Controller does exactly that - its group, user and deploy
 * screens speak Viya REST directly for the calls the adapter does not offer -
 * and the emulator answered those paths with the 404 that says "the emulated
 * estate answers the client's call surface and nothing else". A capture pass
 * driven by the adapter can never see them, so they were outside a scope that
 * was measured from the adapter alone, and the screens they carry were dead on
 * an emulated estate.
 *
 * This file is the second measurement. `spec/viya/app-paths.json` is what Data
 * Controller's client was measured to build (`scripts/viya-app-scope.mjs` re-runs
 * the extraction from a checkout), and every path in it is classified here. The
 * two are held together in both directions, the way the adapter's inventory and
 * `surface.ts` are: a path nobody classified is scope creep nobody chose, and a
 * classification for a path the application no longer builds is a stale claim
 * about what a host has to answer.
 *
 * `decision: 'in'` means a host must answer it. That is a promise the table keeps
 * - `spec/viyaTable.spec.ts` refuses an answered operation no in-scope entry
 * covers - so an `in` entry with no operation is a gap the table spec does not
 * catch. Read the two together: `src/viya/declared.ts` is where an `in` path
 * becomes an operation.
 */
import type { SurfaceFamily } from './surface.js'

export interface AppSurfaceEntry {
  /** Where the application sends it; `{}` is one path segment. */
  path: string
  family: SurfaceFamily
  decision: 'in' | 'declined'
  /** What the emulator answers, or why it does not answer this at all. */
  reason: string
}

/**
 * The application the inventory was measured from.
 *
 * Named rather than assumed: the inventory describes one application's calls,
 * and a second application running on an emulated estate is a second inventory -
 * not an edit to this one, whose rows would then be a claim about a client
 * nobody measured.
 */
export const APP_SURFACE_APPLICATION = {
  name: 'Data Controller for SAS',
  repository: 'https://git.datacontroller.io/dc/dc',
  measuredFrom: 'client/src'
}

/** Why a namespace the API-explorer page lists is not an answered operation. */
const EXPLORER_ONLY =
  'The application names this namespace in its Viya API map, which its API-explorer page reads; no product screen calls it, so the emulated estate does not answer it.'

export const APP_SURFACE: AppSurfaceEntry[] = [
  // the auth flow the client shares with the adapter
  {
    path: '/SASLogon',
    family: 'viya-auth',
    decision: 'in',
    reason:
      'the auth flow, named by the application as well as the adapter, and the reason the emulated paths cannot be renamed'
  },

  // compute: the list, and the read of one context a deploy screen makes
  {
    path: '/compute/contexts',
    family: 'viya-compute',
    decision: 'in',
    reason:
      'the deploy screen lists the contexts it may run a session in, and picks the one the wizard will use'
  },
  {
    path: '/compute/contexts/{}',
    family: 'viya-compute',
    decision: 'in',
    reason:
      'the deploy screen reads each context in full for its batch identity and reuse setting, which the list view does not carry'
  },

  // folders: the two reads an application makes of a deployment folder
  {
    path: '/folders/folders/@item',
    family: 'viya-folders',
    decision: 'in',
    reason:
      'the application resolves its own appLoc by path to find the services it will run'
  },
  {
    path: '/folders/folders/{}/members',
    family: 'viya-folders',
    decision: 'in',
    reason:
      'the application lists the members of the folder it resolved, to find a deployed service'
  },

  // identities: the family the adapter asks one question of and an app asks six
  {
    path: '/identities/groups',
    family: 'viya-identity',
    decision: 'in',
    reason:
      'the deploy screen fetches the group list to offer the admin-group dropdown, and its failure aborts the wizard'
  },
  {
    path: '/identities/groups/{}',
    family: 'viya-identity',
    decision: 'in',
    reason:
      'the group screen appends the group id and a member list to this fragment, to show who holds a group'
  },
  {
    path: '/identities/users',
    family: 'viya-identity',
    decision: 'in',
    reason: 'the user screen lists the accounts the estate holds'
  },
  {
    path: '/identities/users/@currentUser',
    family: 'viya-identity',
    decision: 'in',
    reason:
      'the caller, which the application reads for its own profile as the adapter does'
  },
  {
    path: '/identities/users/@currentUser/memberships',
    family: 'viya-identity',
    decision: 'in',
    reason:
      'the deploy screen filters the group list to the caller own groups, and falls back to all groups when this read fails'
  },
  {
    path: '/identities/users/{}',
    family: 'viya-identity',
    decision: 'in',
    reason:
      'the user screen appends an account id to this fragment for a profile and its memberships'
  },
  {
    path: '/identities/users/{}/avatar/content',
    family: 'viya-identity',
    decision: 'in',
    reason:
      'the header renders the caller avatar from this URL, and an account with none answers the 404 an estate would'
  },

  // the API roots and the explorer-only namespaces: named, never called
  {
    path: '/identities',
    family: 'viya-identity',
    decision: 'declined',
    reason:
      'the service root the application API map lists for its explorer page, not an endpoint any screen calls'
  },
  {
    path: '/folders',
    family: 'viya-folders',
    decision: 'declined',
    reason:
      'the service root the application API map lists for its explorer page, not an endpoint any screen calls'
  },
  {
    path: '/files',
    family: 'viya-files',
    decision: 'declined',
    reason:
      'the service root the application API map lists for its explorer page, not an endpoint any screen calls'
  },
  {
    path: '/jobDefinitions',
    family: 'viya-jobs',
    decision: 'declined',
    reason:
      'the service root the application API map lists for its explorer page, not an endpoint any screen calls'
  },
  {
    path: '/jobExecution',
    family: 'viya-jobs',
    decision: 'declined',
    reason:
      'the service root the application API map lists for its explorer page, not an endpoint any screen calls'
  },
  {
    path: '/annotations',
    family: 'viya-files',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/authorization',
    family: 'viya-identity',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/businessRules',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/dataMining',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/decisionsRuntimeBuilder',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/insights',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/microanalyticScore',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/mlPipelineAutomation',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/modelManagement',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/modelPublish',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/modelRepository',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/referenceData',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/relationships',
    family: 'viya-folders',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/reportImages',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/reportTransforms',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/reports',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/subjectContacts',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/treatmentDefinitions',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  },
  {
    path: '/visualAnalytics',
    family: 'viya-jobs',
    decision: 'declined',
    reason: EXPLORER_ONLY
  }
]
