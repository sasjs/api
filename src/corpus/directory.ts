import type { CorpusCase } from './drive.js'
import type { DirectorySource } from '../directory/service.js'

/**
 * The directory the corpus host answers with.
 *
 * One user and one group that the default identity fixture does not already
 * hold (`admin`/`user2` and `Admins`/`DCGroup` are in it), so the case pins the
 * counts of what an import creates rather than what it found.
 */
export const CORPUS_DIRECTORY: DirectorySource = {
  users: async () => [{ username: 'alice', displayName: 'Alice' }],
  groups: async () => [{ name: 'analysts' }]
}

/**
 * The directory corpus.
 *
 * `401` and `500` are host-only - the administrator middleware and the
 * directory's own failures - so the one documented status this package answers
 * is `200`, carrying what it created. The import's own rules (existing accounts
 * untouched, membership, refusals) are pinned in `spec/directory.spec`.
 */
export const DIRECTORY_CORPUS: CorpusCase[] = [
  {
    id: 'directory-imports-the-missing-accounts',
    route: 'POST /SASjsApi/authConfig/synchroniseWithLDAP',
    description:
      'imports the users and groups the store does not hold, and counts them',
    request: {},
    expect: { status: 200, body: { userCount: 1, groupCount: 1 } }
  }
]
