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
