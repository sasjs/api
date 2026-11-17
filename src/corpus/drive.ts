/**
 * The conformance corpus: what the API does, as data.
 *
 * Each case names an operation, the request a client would make, and the answer
 * a client expects - the status, the body, or the file's contents. The same
 * cases run against a live sasjs/server and against the browser build, which is
 * the only way "the same API" becomes something a test can hold; two hand-
 * written suites is how the header seed and the webout block drifted.
 *
 * The statuses and the wording are the implementation's (sasjs/server's
 * controllers), not the published document's, and `src/routes/overlay.ts`
 * records each place the two disagree.
 */
import type { ApiRequest } from '../host/dispatch.js'
import { DEPLOYMENT_FILE_ERROR } from '../drive/deploymentFile.js'
import { DEFAULT_IDENTITY, type IdentityFixture } from '../identity/fixture.js'
import type { AppStreamEntry } from '../appstream/service.js'

export interface CorpusCase {
  /** Stable name, used as the test's title. */
  id: string
  /** The operation, `METHOD /path` as the route table states it. */
  route: string
  description: string
  /** Files the case starts from. */
  seed?: Record<string, string | Uint8Array>
  /** The identity the case starts from; the default fixture when omitted. */
  identity?: IdentityFixture
  /**
   * The apps the case starts from; the default fixture when omitted.
   *
   * An index holds two shapes - an app published as a frontend at `apps/<name>`,
   * and the older one served out of a folder's `services/` - and a case that only
   * ever starts from one of them cannot see a route that reads the other wrong.
   */
  appStream?: AppStreamEntry[]
  /**
   * The drive refuses every write, so a case can pin the refusal a route answers
   * when storing fails - `POST /drive/deploy` documents a `500`, and a mock drive
   * that always accepts writes could never produce one.
   */
  unwritable?: boolean
  /**
   * What the case's program produces, for a route that runs one.
   *
   * A mock cannot know what a program writes, so the corpus states it: a case
   * that pins an output needs a runner that answers with one, and the output is
   * then the only thing about the run the case asserts.
   */
  runOutput?: { contents: string | Uint8Array; contentType?: string }
  /** The run fails, so a case can pin the `400` a failed run answers. */
  failingRun?: boolean
  /**
   * Which host transport can produce this request, where only one can.
   *
   * Most cases are reachable either way: a host that expands an archive before it
   * dispatches, and one that takes the archive and expands it itself. A case whose
   * request no archive could produce - a tree that is not a tree - is reachable
   * only by the first, and says so here rather than in the filter of each host that
   * runs the corpus.
   */
  transport?: 'expansion' | 'archive'
  /**
   * The state the case leaves in the drive, where a status cannot see it.
   *
   * The deploy routes' `replace` policy is exactly that: both answers are `200`
   * and the difference is a file the drive does or does not still hold, so a case
   * that pinned only the status would let a host drop the option.
   */
  expectDrive?: {
    /** Files the drive must hold once the case has run. */
    present?: string[]
    /** Files it must not: the ones a replacement removes, or never writes. */
    missing?: string[]
  }
  request: ApiRequest
  expect: {
    status: number
    body?: unknown
    contents?: string | Uint8Array
    /** The refusal's message, where the case expects one. */
    error?: string
    /**
     * The properties a body must carry, where the host mints the rest - a user's
     * `uid` is the host's identifier, so a case pinning one would be pinning a
     * fixture value into the contract.
     */
    partial?: Record<string, unknown>
    /**
     * The properties a body must carry, where the values are the host's - a
     * minted token is not a value a case can state.
     */
    keys?: string[]
    /**
     * The body's shape, where every value is the host's.
     *
     * `required` must all be present and every property the body carries must be
     * named in `required` or `optional` - the document's `additionalProperties:
     * false` stated as an assertion. A case that pins `body` or `keys` on such a
     * route pins one host's values into the contract, which the live server then
     * fails: `GET /SASjsApi/info` answers a mode, ports and a version that differ
     * per host while every host answers the same shape.
     */
    shape?: {
      required: string[]
      optional?: string[]
    }
    /**
     * How the body travels, where a string could be either. `json` is a JSON
     * string on the wire - what tsoa emits for `Promise<string>` and what the
     * server's `res.json` sends; `text` is a body the route sends itself, which
     * the document carries in the `description` with no content. A case that
     * names neither is read as `text` when the document declares no content and
     * as `json` when it does.
     */
    encoding?: 'json' | 'text'
  }
}

/** The fixture's administrator: the caller these routes are exercised as. */
const ADMIN = { userId: 'user-admin', clientId: 'web_app' }

/**
 * The restricted account, which the fixture grants `/drive/file` to through its
 * group and nothing else in the drive.
 */
const RESTRICTED = { userId: 'user-restricted', clientId: 'web_app' }

/** The restricted account without its group grant, for the denial cases. */
const NO_DRIVE_GRANTS: IdentityFixture = {
  ...DEFAULT_IDENTITY,
  permissions: DEFAULT_IDENTITY.permissions.filter(
    (rule) => rule.uid !== 'rule-routes'
  )
}

const PUBLIC_FILE: IdentityFixture = {
  ...DEFAULT_IDENTITY,
  groups: [
    ...DEFAULT_IDENTITY.groups,
    {
      uid: 'group-public',
      name: 'public',
      description: 'Everyone',
      isActive: true,
      users: []
    }
  ],
  permissions: [
    ...DEFAULT_IDENTITY.permissions,
    {
      uid: 'rule-public-file',
      path: '/SASjsApi/drive/file',
      type: 'Route',
      setting: 'Grant',
      group: 'group-public'
    }
  ]
}

const success = { status: 'success' }

/**
 * Bytes without an encoding API: the package builds with `lib: ES2020` and no
 * ambient types, so a `TextEncoder` reference would compile here and fail in a
 * host that does not have one. An explicit byte array is both.
 */
const bytes = (...values: number[]) => Uint8Array.from(values)

/** A flat tree of `count` empty file members, for the cap's entry dimension. */
const manyMembers = (count: number) =>
  Array.from({ length: count }, (_, at) => ({
    name: `f${at}.txt`,
    type: 'file',
    code: ''
  }))

export const DRIVE_CORPUS: CorpusCase[] = [
  {
    id: 'create-file',
    route: 'POST /SASjsApi/drive/file',
    description: 'creates a file the drive did not have',
    request: {
      subject: ADMIN,
      query: { _filePath: '/data/users.csv' },
      file: { name: 'users.csv', contents: 'id,name\n1,Ann\n' }
    },
    expect: { status: 200, body: success }
  },
  {
    id: 'create-file-at-form-path',
    route: 'POST /SASjsApi/drive/file',
    description:
      'takes the destination from the form field when the query has none',
    request: {
      subject: ADMIN,
      file: { name: 'x.csv', contents: 'x' },
      body: { filePath: '/data/from-form.csv' }
    },
    expect: { status: 200, body: success }
  },
  {
    id: 'create-file-over-existing',
    route: 'POST /SASjsApi/drive/file',
    description: 'refuses a create over a file that exists, as 409',
    seed: { '/data/exists.csv': 'a' },
    request: {
      subject: ADMIN,
      query: { _filePath: '/data/exists.csv' },
      file: { name: 'x', contents: 'b' }
    },
    expect: { status: 409, error: 'File already exists.' }
  },
  {
    id: 'create-file-blocked-extension',
    route: 'POST /SASjsApi/drive/file',
    description: 'refuses a refused extension before touching the drive',
    request: {
      subject: ADMIN,
      query: { _filePath: '/data/run.sh' },
      file: { name: 'run.sh', contents: 'x' }
    },
    expect: { status: 400, error: 'Invalid file extension' }
  },
  {
    id: 'create-file-outside-drive',
    route: 'POST /SASjsApi/drive/file',
    description: 'refuses a path that climbs out of the drive',
    request: {
      subject: ADMIN,
      query: { _filePath: '/../escape.csv' },
      file: { name: 'x', contents: 'x' }
    },
    expect: { status: 400, error: "Can't put file outside drive." }
  },
  {
    id: 'create-file-without-payload',
    route: 'POST /SASjsApi/drive/file',
    description: 'answers for a missing file with the server wording',
    request: {
      subject: ADMIN,
      query: { _filePath: '/data/x.csv' }
    },
    expect: { status: 400, error: '"file" is not present.' }
  },
  {
    id: 'create-file-without-destination',
    route: 'POST /SASjsApi/drive/file',
    description:
      'answers for a missing destination with the validation wording',
    request: {
      subject: ADMIN,
      file: { name: 'x', contents: 'x' }
    },
    expect: { status: 400, error: '"_filePath" is required' }
  },
  {
    id: 'replace-file',
    route: 'PATCH /SASjsApi/drive/file',
    description: 'replaces the contents of a file that exists',
    seed: { '/data/keep.csv': 'old' },
    request: {
      subject: ADMIN,
      query: { _filePath: '/data/keep.csv' },
      file: { name: 'keep.csv', contents: 'new' }
    },
    expect: { status: 200, body: success }
  },
  {
    id: 'replace-file-missing',
    route: 'PATCH /SASjsApi/drive/file',
    description: 'refuses a replace of a file that is not there, as 404',
    request: {
      subject: ADMIN,
      query: { _filePath: '/data/missing.csv' },
      file: { name: 'x', contents: 'x' }
    },
    expect: { status: 404, error: `File doesn't exist.` }
  },
  {
    id: 'replace-file-outside-drive',
    route: 'PATCH /SASjsApi/drive/file',
    description: 'refuses a replace of a path that climbs out of the drive',
    request: {
      subject: ADMIN,
      query: { _filePath: '/../escape.csv' },
      file: { name: 'x', contents: 'x' }
    },
    expect: { status: 400, error: "Can't modify file outside drive." }
  },
  {
    id: 'read-file',
    route: 'GET /SASjsApi/drive/file',
    description: 'answers with the file contents',
    seed: { '/data/keep.csv': 'a,b\n1,2\n' },
    request: {
      subject: ADMIN,
      query: { _filePath: '/data/keep.csv' }
    },
    expect: { status: 200, contents: 'a,b\n1,2\n' }
  },
  {
    id: 'read-file-missing',
    route: 'GET /SASjsApi/drive/file',
    description: 'refuses a read of a file that is not there',
    request: {
      subject: ADMIN,
      query: { _filePath: '/data/missing.csv' }
    },
    expect: { status: 404, error: `File doesn't exist.` }
  },
  {
    id: 'read-file-outside-drive',
    route: 'GET /SASjsApi/drive/file',
    description: 'refuses a read of a path that climbs out of the drive',
    request: {
      subject: ADMIN,
      query: { _filePath: '/../escape.csv' }
    },
    expect: { status: 400, error: "Can't get file outside drive." }
  },
  {
    id: 'read-file-names-both',
    route: 'GET /SASjsApi/drive/file',
    description: 'refuses a request that names the file twice, in two readings',
    seed: { '/data/keep.csv': 'a' },
    request: {
      subject: ADMIN,
      query: { _filePath: '/data/keep.csv', _FILE: '/data/keep.csv' }
    },
    expect: {
      status: 400,
      error: 'Exactly one of "_filePath" and "_FILE" may be given.'
    }
  },
  {
    id: 'read-streamed-file',
    route: 'GET /SASjsApi/drive/file',
    description: 'reads a deployment file by the name a streamed page links to',
    seed: { '/Public/app/services/web/main.js': 'console.log(1)' },
    request: {
      subject: ADMIN,
      query: { _FILE: '/Public/app/services/web/main.js' }
    },
    expect: { status: 200, contents: 'console.log(1)' }
  },
  {
    id: 'read-streamed-file-missing',
    route: 'GET /SASjsApi/drive/file',
    description:
      'answers a missing deployment file the way the estate does, not as a 404',
    request: {
      subject: ADMIN,
      query: { _FILE: '/Public/app/services/web/gone.js' }
    },
    expect: { status: 202, contents: DEPLOYMENT_FILE_ERROR }
  },
  {
    id: 'delete-file',
    route: 'DELETE /SASjsApi/drive/file',
    description: 'deletes a file that exists',
    seed: { '/data/keep.csv': 'a' },
    request: {
      subject: ADMIN,
      query: { _filePath: '/data/keep.csv' }
    },
    expect: { status: 200, body: success }
  },
  {
    id: 'delete-file-missing',
    route: 'DELETE /SASjsApi/drive/file',
    description: 'refuses a delete of a file that is not there',
    request: {
      subject: ADMIN,
      query: { _filePath: '/data/missing.csv' }
    },
    expect: { status: 404, error: `File doesn't exist.` }
  },
  {
    id: 'delete-file-outside-drive',
    route: 'DELETE /SASjsApi/drive/file',
    description: 'refuses a delete of a path that climbs out of the drive',
    request: {
      subject: ADMIN,
      query: { _filePath: '/../escape.csv' }
    },
    expect: { status: 400, error: "Can't delete file outside drive." }
  },
  {
    id: 'list-folder',
    route: 'GET /SASjsApi/drive/folder',
    description: 'lists the files and folders of a folder',
    seed: { '/data/a.csv': 'a', '/data/reports/b.csv': 'b' },
    request: {
      subject: ADMIN,
      query: { _folderPath: '/data' }
    },
    expect: { status: 200, body: { files: ['a.csv'], folders: ['reports'] } }
  },
  {
    id: 'list-folder-missing',
    route: 'GET /SASjsApi/drive/folder',
    description: 'refuses a listing of a folder that is not there',
    request: {
      subject: ADMIN,
      query: { _folderPath: '/nope' }
    },
    expect: { status: 404, error: `Folder doesn't exist.` }
  },
  {
    id: 'list-folder-outside-drive',
    route: 'GET /SASjsApi/drive/folder',
    description: 'refuses a listing of a path that climbs out of the drive',
    request: {
      subject: ADMIN,
      query: { _folderPath: '/../escape' }
    },
    expect: { status: 400, error: "Can't get folder outside drive." }
  },
  {
    id: 'delete-folder-without-path',
    route: 'DELETE /SASjsApi/drive/folder',
    description:
      'answers for a missing folder path, because the table marks it required',
    request: {
      subject: ADMIN
    },
    expect: { status: 400, error: '"_folderPath" is required' }
  },
  {
    id: 'create-folder-without-path',
    route: 'POST /SASjsApi/drive/folder',
    description: 'answers for a missing folder path in the body',
    request: {
      subject: ADMIN,
      body: {}
    },
    expect: { status: 400, error: '"folderPath" is required' }
  },
  {
    id: 'create-folder',
    route: 'POST /SASjsApi/drive/folder',
    description: 'creates a folder',
    request: {
      subject: ADMIN,
      body: { folderPath: '/data/reports' }
    },
    expect: { status: 200, body: success }
  },
  {
    id: 'create-folder-existing',
    route: 'POST /SASjsApi/drive/folder',
    description: 'refuses a folder that already exists, as 409',
    seed: { '/data/reports/a.csv': 'a' },
    request: {
      subject: ADMIN,
      body: { folderPath: '/data/reports' }
    },
    expect: { status: 409, error: 'Folder already exists.' }
  },
  {
    id: 'delete-folder',
    route: 'DELETE /SASjsApi/drive/folder',
    description: 'deletes a folder with everything under it',
    seed: { '/data/reports/a.csv': 'a', '/data/reports/nested/b.csv': 'b' },
    request: {
      subject: ADMIN,
      query: { _folderPath: '/data/reports' }
    },
    expect: { status: 200, body: success }
  },
  {
    id: 'delete-folder-missing',
    route: 'DELETE /SASjsApi/drive/folder',
    description: 'refuses a delete of a folder that is not there',
    request: {
      subject: ADMIN,
      query: { _folderPath: '/nope' }
    },
    expect: { status: 404, error: `Folder doesn't exist.` }
  },
  {
    id: 'rename-file',
    route: 'POST /SASjsApi/drive/rename',
    description: 'moves a file to a new path',
    seed: { '/data/old.csv': 'r' },
    request: {
      subject: ADMIN,
      body: { oldPath: '/data/old.csv', newPath: '/data/new.csv' }
    },
    expect: { status: 200, body: success }
  },
  {
    id: 'rename-onto-existing',
    route: 'POST /SASjsApi/drive/rename',
    description: 'refuses a move onto something that exists',
    seed: { '/data/a.csv': 'a', '/data/b.csv': 'b' },
    request: {
      subject: ADMIN,
      body: { oldPath: '/data/a.csv', newPath: '/data/b.csv' }
    },
    expect: { status: 409, error: 'File with new name already exists.' }
  },
  {
    id: 'rename-missing',
    route: 'POST /SASjsApi/drive/rename',
    description: 'refuses a move of something that is not there',
    request: {
      subject: ADMIN,
      body: { oldPath: '/data/nope.csv', newPath: '/data/x.csv' }
    },
    expect: { status: 404, error: 'No file/folder found for provided path.' }
  },
  {
    id: 'rename-file-to-blocked-extension',
    route: 'POST /SASjsApi/drive/rename',
    description:
      'refuses a rename that would produce a name the file routes refuse',
    seed: { '/data/report.csv': 'a,b' },
    request: {
      subject: ADMIN,
      body: { oldPath: '/data/report.csv', newPath: '/data/report.sh' }
    },
    expect: { status: 400, error: 'Invalid file extension' }
  },
  {
    id: 'rename-folder-to-dotted-name',
    route: 'POST /SASjsApi/drive/rename',
    description: 'renames a folder whose new name carries a blocked suffix',
    seed: { '/data/reports/a.csv': 'a' },
    request: {
      subject: ADMIN,
      body: { oldPath: '/data/reports', newPath: '/data/reports.sh' }
    },
    expect: { status: 200, body: { status: 'success' } }
  },
  {
    id: 'rename-folder-into-itself',
    route: 'POST /SASjsApi/drive/rename',
    description:
      'refuses a folder moved inside itself, which the server loses at the filesystem',
    seed: { '/data/reports/a.csv': 'a' },
    request: {
      subject: ADMIN,
      body: { oldPath: '/data/reports', newPath: '/data/reports/nested' }
    },
    expect: {
      status: 400,
      error: "New path can't be inside the folder being moved."
    }
  },
  {
    id: 'tree',
    route: 'GET /SASjsApi/drive/filetree',
    description: 'answers with the drive tree',
    seed: { '/data/a.csv': 'a' },
    request: {
      subject: ADMIN,
      query: { _folderPath: '/data' }
    },
    expect: {
      status: 200,
      // Partial, because a file's `created` and `modified` are the host's
      // clock rather than the contract: the shape is asserted, the timestamps
      // are whatever the host that ran the case says they are.
      partial: {
        status: 'success',
        tree: {
          name: 'data',
          relativePath: '/data',
          isFolder: true,
          children: [
            {
              name: 'a.csv',
              relativePath: '/data/a.csv',
              isFolder: false,
              children: []
            }
          ]
        }
      }
    }
  },
  {
    id: 'deploy-tree',
    route: 'POST /SASjsApi/drive/deploy',
    description: 'writes a whole tree under the appLoc it names',
    request: {
      subject: ADMIN,
      body: {
        appLoc: '/Public/apps/demo',
        fileTree: {
          members: [
            {
              name: 'services',
              type: 'folder',
              members: [{ name: 'run', type: 'service', code: '%put hi;' }]
            },
            { name: 'index.html', type: 'file', code: 'PGgxPkhlbGxvPC9oMT4=' }
          ]
        }
      }
    },
    expect: {
      status: 200,
      body: {
        status: 'success',
        message: 'Files deployed successfully to @sasjs/server.'
      }
    }
  },
  {
    id: 'deploy-refused-by-entry-count',
    route: 'POST /SASjsApi/drive/deploy',
    description:
      'refuses a tree over the entry cap, naming the figure and the cap',
    request: {
      subject: ADMIN,
      body: {
        appLoc: '/Public/apps/many',
        fileTree: { members: manyMembers(10001) }
      }
    },
    expect: {
      status: 413,
      body: {
        status: 'failure',
        message:
          'The file tree exceeds the deploy limit: 10001 entries (maximum 10000).'
      },
      error:
        'The file tree exceeds the deploy limit: 10001 entries (maximum 10000).'
    }
  },
  {
    id: 'deploy-refused-by-name',
    route: 'POST /SASjsApi/drive/deploy',
    description: 'refuses a member name that would escape the deployment root',
    request: {
      subject: ADMIN,
      body: {
        appLoc: '/Public/apps/hostile',
        fileTree: {
          members: [{ name: '../escape', type: 'service', code: '%put hi;' }]
        }
      }
    },
    expect: {
      status: 400,
      body: {
        status: 'failure',
        message:
          "Invalid member name: '../escape.sas'. Member names must be single path segments (no '/', '\\', '..')."
      },
      error:
        "Invalid member name: '../escape.sas'. Member names must be single path segments (no '/', '\\', '..')."
    }
  },
  {
    id: 'deploy-refused-by-shape',
    route: 'POST /SASjsApi/drive/deploy',
    description:
      'refuses a fileTree that is not a tree, in the routes own envelope',
    request: {
      subject: ADMIN,
      body: { appLoc: '/Public/apps/bad', fileTree: { members: 1 } }
    },
    expect: {
      status: 400,
      body: {
        status: 'failure',
        message: 'Provided not supported data format.'
      },
      error: 'Provided not supported data format.'
    }
  },
  {
    id: 'deploy-refused-by-store',
    route: 'POST /SASjsApi/drive/deploy',
    description: 'answers the routes 500 when the drive refuses the write',
    unwritable: true,
    request: {
      subject: ADMIN,
      body: {
        appLoc: '/Public/apps/demo',
        fileTree: {
          members: [{ name: 'run', type: 'service', code: '%put hi;' }]
        }
      }
    },
    expect: {
      status: 500,
      body: { status: 'failure', message: 'Deployment failed!' },
      error: 'Deployment failed!'
    }
  },
  {
    id: 'deploy-refused-outside-drive',
    route: 'POST /SASjsApi/drive/deploy',
    description: 'refuses an appLoc that resolves outside the drive',
    request: {
      subject: ADMIN,
      body: { appLoc: '/../outside', fileTree: { members: [] } }
    },
    expect: {
      status: 400,
      body: { status: 'failure', message: 'appLoc cannot be outside drive.' },
      error: 'appLoc cannot be outside drive.'
    }
  },
  {
    id: 'bytes-round-trip',
    route: 'GET /SASjsApi/drive/file',
    description: 'keeps a byte file as bytes',
    seed: { '/data/pack.zip': bytes(80, 75, 3, 4) },
    request: {
      subject: ADMIN,
      query: { _filePath: '/data/pack.zip' }
    },
    expect: { status: 200, contents: bytes(80, 75, 3, 4) }
  },

  // --------------------------------------------------- the rule that decides
  {
    id: 'read-file-anonymous-public-grant',
    route: 'GET /SASjsApi/drive/file',
    description:
      'admits an anonymous caller through an exact public group grant',
    identity: PUBLIC_FILE,
    seed: { '/data/public.csv': 'public contents' },
    request: { query: { _filePath: '/data/public.csv' } },
    expect: { status: 200, contents: 'public contents' }
  },
  {
    id: 'read-file-public-invalid-token',
    route: 'GET /SASjsApi/drive/file',
    description:
      'treats an invalid token as anonymous on an exactly public route',
    identity: PUBLIC_FILE,
    seed: { '/data/public.csv': 'public contents' },
    request: {
      token: 'invalid-token',
      query: { _filePath: '/data/public.csv' }
    },
    expect: { status: 200, contents: 'public contents' }
  },
  {
    id: 'read-file-public-inactive-token',
    route: 'GET /SASjsApi/drive/file',
    description:
      'treats a deactivated token as anonymous on an exactly public route',
    identity: {
      ...PUBLIC_FILE,
      users: PUBLIC_FILE.users.map((user) =>
        user.uid === 'user-restricted' ? { ...user, isActive: false } : user
      ),
      tokens: [
        {
          username: 'sasjsuser',
          clientId: 'web_app',
          accessToken: 'inactive-access',
          refreshToken: 'inactive-refresh'
        }
      ]
    },
    seed: { '/data/public.csv': 'public contents' },
    request: {
      token: 'inactive-access',
      query: { _filePath: '/data/public.csv' }
    },
    expect: { status: 200, contents: 'public contents' }
  },
  {
    id: 'create-file-anonymous-public-grant',
    route: 'POST /SASjsApi/drive/file',
    description: 'admits public writes when the exact route is granted',
    identity: PUBLIC_FILE,
    request: {
      query: { _filePath: '/data/new.csv' },
      file: { name: 'new.csv', contents: 'new' }
    },
    expect: { status: 200, body: success },
    expectDrive: { present: ['/data/new.csv'] }
  },
  {
    id: 'read-folder-anonymous-other-public-grant',
    route: 'GET /SASjsApi/drive/folder',
    description: 'refuses an anonymous caller when a different path is public',
    identity: PUBLIC_FILE,
    request: { query: { _folderPath: '/data' } },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'read-file-anonymous-public-parent-grant',
    route: 'GET /SASjsApi/drive/file',
    description: 'does not inherit public authentication from a parent grant',
    identity: {
      ...PUBLIC_FILE,
      permissions: PUBLIC_FILE.permissions.map((rule) =>
        rule.uid === 'rule-public-file' ? { ...rule, path: '/SASjsApi' } : rule
      )
    },
    seed: { '/data/public.csv': 'public contents' },
    request: { query: { _filePath: '/data/public.csv' } },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'read-file-anonymous-public-deny',
    route: 'GET /SASjsApi/drive/file',
    description:
      'does not authenticate an anonymous caller through a public deny',
    identity: {
      ...PUBLIC_FILE,
      permissions: PUBLIC_FILE.permissions.map((rule) =>
        rule.uid === 'rule-public-file' ? { ...rule, setting: 'Deny' } : rule
      )
    },
    request: { query: { _filePath: '/data/public.csv' } },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'read-file-public-user-deny',
    route: 'GET /SASjsApi/drive/file',
    description:
      'admits an authenticated caller despite an explicit user deny on a public route',
    identity: {
      ...PUBLIC_FILE,
      permissions: [
        ...PUBLIC_FILE.permissions,
        {
          uid: 'user-file-deny',
          path: '/SASjsApi/drive/file',
          type: 'Route',
          setting: 'Deny',
          user: 'user-restricted'
        }
      ]
    },
    seed: { '/data/public.csv': 'public contents' },
    request: { subject: RESTRICTED, query: { _filePath: '/data/public.csv' } },
    expect: { status: 200, contents: 'public contents' }
  },
  {
    id: 'read-file-granted-by-a-group-rule',
    route: 'GET /SASjsApi/drive/file',
    description:
      'admits a restricted account the fixture grants this route, so the refusal beside it is the rule',
    seed: { '/data/keep.csv': 'a,b\n1,2\n' },
    request: { subject: RESTRICTED, query: { _filePath: '/data/keep.csv' } },
    expect: { status: 200, contents: 'a,b\n1,2\n' }
  },
  {
    id: 'rename-file-denied-to-a-restricted-account',
    route: 'POST /SASjsApi/drive/rename',
    description:
      'refuses a drive route the rules do not grant, with the 401 a missing token earns',
    seed: { '/data/old.csv': 'r' },
    request: {
      subject: RESTRICTED,
      body: { oldPath: '/data/old.csv', newPath: '/data/new.csv' }
    },
    expect: { status: 401, error: 'Unauthorized' }
  },
  // The permission gate refuses a caller the rules do not grant, on every route
  // the inventory addresses. Each of these is the same account and the same
  // refusal - the gate runs before the payload is read, which is why a bare
  // request answers 401 rather than the 400 a missing parameter would earn.
  ...[
    'GET /SASjsApi/drive/file',
    'GET /SASjsApi/drive/folder',
    'GET /SASjsApi/drive/filetree',
    'POST /SASjsApi/drive/file',
    'PATCH /SASjsApi/drive/file',
    'DELETE /SASjsApi/drive/file',
    'POST /SASjsApi/drive/folder',
    'DELETE /SASjsApi/drive/folder',
    'POST /SASjsApi/drive/deploy',
    'DELETE /SASjsApi/drive/deploy',
    'POST /SASjsApi/drive/deploy/upload'
  ].map((route) => ({
    id: `${route.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-denied-to-a-restricted-account`,
    route,
    description:
      'refuses a drive route the rules do not grant, before it reads the payload',
    identity: NO_DRIVE_GRANTS,
    request: { subject: RESTRICTED },
    expect: { status: 401, error: 'Unauthorized' }
  }))
]
