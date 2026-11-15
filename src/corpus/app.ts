/**
 * The App Stream detail route's conformance corpus.
 *
 * `GET /SASjsApi/app/{id}` describes an app by its id: the entry as registered, the
 * file it is served from, and whether that file is there. Two answers are the
 * package's - the `200` and the `404` - and both have a case here, which is what
 * `spec/corpus-parity.spec.ts` enforces in both directions. The `401` is the host's
 * (the route is mounted behind its authenticator) and is marked as such in the
 * overlay.
 *
 * The cases name the same app the rest of the corpus starts from (`CORPUS_APP`), so
 * a host running this corpus against a live server sees the same id the package
 * answers for.
 */
import type { CorpusCase } from './drive.js'
import { CORPUS_APP } from './runner.js'

const SUBJECT = { userId: 'user-admin', clientId: 'web_app' }

/**
 * An app published as a frontend: a name, a folder that follows from it, and no
 * backend of its own.
 */
const FRONTEND_APP = {
  id: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a',
  name: 'frontend-only',
  appLoc: '/Public/app/shared',
  publishedAt: '2026-02-02T00:00:00.000Z'
}

/** Where that app's files are read from, which nothing on the entry records. */
const FRONTEND_ENTRY_FILE = `/apps/${FRONTEND_APP.name}/index.html`

/** Where the app's streamed entry file sits inside its folder. */
const ENTRY_FILE_PATH = `${CORPUS_APP.appLoc}/services/${CORPUS_APP.streamWebFolder}/index.html`

export const APP_CORPUS: CorpusCase[] = [
  {
    id: 'app-detail-published',
    route: 'GET /SASjsApi/app/{id}',
    description:
      'describes the app the id names, and the entry file it is served from',
    // the deployment the index entry points at: the entry file is on the drive, so
    // `entryFileExists` is the answer this case is really about
    seed: { [ENTRY_FILE_PATH]: '<!doctype html><title>app</title>' },
    request: { subject: SUBJECT, params: { id: CORPUS_APP.id } },
    expect: {
      status: 200,
      // the entry as registered, and the file it is served from. `lastModified` is
      // the host's clock and not pinned: a drive with no clock answers `null`, one
      // with a filesystem answers the time the seed was written.
      partial: {
        id: CORPUS_APP.id,
        name: CORPUS_APP.name,
        appLoc: CORPUS_APP.appLoc,
        streamWebFolder: CORPUS_APP.streamWebFolder,
        publishedAt: CORPUS_APP.publishedAt,
        entryFile: 'index.html',
        entryFileExists: true,
        url: `/app/${CORPUS_APP.id}/`
      }
    }
  },
  {
    id: 'app-detail-frontend',
    route: 'GET /SASjsApi/app/{id}',
    description:
      'describes an app published as a frontend, from the folder its name derives',
    // the two shapes an index can hold: a frontend entry names neither `appLoc`
    // nor `streamWebFolder`, so a route that reads those by hand answers "no file"
    // for a deployment that is right there
    appStream: [FRONTEND_APP],
    seed: { [FRONTEND_ENTRY_FILE]: '<!doctype html><title>frontend</title>' },
    request: { subject: SUBJECT, params: { id: FRONTEND_APP.id } },
    expect: {
      status: 200,
      partial: {
        id: FRONTEND_APP.id,
        name: FRONTEND_APP.name,
        frontendFolder: `/apps/${FRONTEND_APP.name}`,
        appLoc: FRONTEND_APP.appLoc,
        entryFile: 'index.html',
        entryFileExists: true,
        url: `/app/${FRONTEND_APP.id}/`
      }
    }
  },
  {
    id: 'app-detail-entry-file-missing',
    route: 'GET /SASjsApi/app/{id}',
    description:
      'answers the entry as registered with no file and no date, for a deployment that is gone',
    // the index entry outlived its folder: no seed, so nothing is deployed
    request: { subject: SUBJECT, params: { id: CORPUS_APP.id } },
    expect: {
      status: 200,
      partial: { entryFileExists: false, lastModified: null }
    }
  },
  {
    id: 'app-detail-unknown-id',
    route: 'GET /SASjsApi/app/{id}',
    description:
      'refuses an id the index does not hold, in the route’s own wording',
    request: {
      subject: SUBJECT,
      params: { id: '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a' }
    },
    expect: { status: 404, error: 'No App Stream is registered with that id.' }
  }
]
