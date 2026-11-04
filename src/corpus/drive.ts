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

export interface CorpusCase {
  /** Stable name, used as the test's title. */
  id: string
  /** The operation, `METHOD /path` as the route table states it. */
  route: string
  description: string
  /** Files the case starts from. */
  seed?: Record<string, string | Uint8Array>
  request: ApiRequest
  expect: {
    status: number
    body?: unknown
    contents?: string | Uint8Array
    /** The refusal's message, where the case expects one. */
    error?: string
  }
}

const success = { status: 'success' }

/**
 * Bytes without an encoding API: the package builds with `lib: ES2020` and no
 * ambient types, so a `TextEncoder` reference would compile here and fail in a
 * host that does not have one. An explicit byte array is both.
 */
const bytes = (...values: number[]) => Uint8Array.from(values)

export const DRIVE_CORPUS: CorpusCase[] = [
  {
    id: 'create-file',
    route: 'POST /SASjsApi/drive/file',
    description: 'creates a file the drive did not have',
    request: {
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
      query: { _filePath: '/../escape.csv' },
      file: { name: 'x', contents: 'x' }
    },
    expect: { status: 400, error: "Can't put file outside drive." }
  },
  {
    id: 'create-file-without-payload',
    route: 'POST /SASjsApi/drive/file',
    description: 'answers for a missing file with the server wording',
    request: { query: { _filePath: '/data/x.csv' } },
    expect: { status: 400, error: '"file" is not present.' }
  },
  {
    id: 'create-file-without-destination',
    route: 'POST /SASjsApi/drive/file',
    description:
      'answers for a missing destination with the validation wording',
    request: { file: { name: 'x', contents: 'x' } },
    expect: { status: 400, error: '"_filePath" is required' }
  },
  {
    id: 'replace-file',
    route: 'PATCH /SASjsApi/drive/file',
    description: 'replaces the contents of a file that exists',
    seed: { '/data/keep.csv': 'old' },
    request: {
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
      query: { _filePath: '/data/missing.csv' },
      file: { name: 'x', contents: 'x' }
    },
    expect: { status: 404, error: `File doesn't exist.` }
  },
  {
    id: 'read-file',
    route: 'GET /SASjsApi/drive/file',
    description: 'answers with the file contents',
    seed: { '/data/keep.csv': 'a,b\n1,2\n' },
    request: { query: { _filePath: '/data/keep.csv' } },
    expect: { status: 200, contents: 'a,b\n1,2\n' }
  },
  {
    id: 'read-file-missing',
    route: 'GET /SASjsApi/drive/file',
    description: 'refuses a read of a file that is not there',
    request: { query: { _filePath: '/data/missing.csv' } },
    expect: { status: 404, error: `File doesn't exist.` }
  },
  {
    id: 'delete-file',
    route: 'DELETE /SASjsApi/drive/file',
    description: 'deletes a file that exists',
    seed: { '/data/keep.csv': 'a' },
    request: { query: { _filePath: '/data/keep.csv' } },
    expect: { status: 200, body: success }
  },
  {
    id: 'delete-file-missing',
    route: 'DELETE /SASjsApi/drive/file',
    description: 'refuses a delete of a file that is not there',
    request: { query: { _filePath: '/data/missing.csv' } },
    expect: { status: 404, error: `File doesn't exist.` }
  },
  {
    id: 'list-folder',
    route: 'GET /SASjsApi/drive/folder',
    description: 'lists the files and folders of a folder',
    seed: { '/data/a.csv': 'a', '/data/reports/b.csv': 'b' },
    request: { query: { _folderPath: '/data' } },
    expect: { status: 200, body: { files: ['a.csv'], folders: ['reports'] } }
  },
  {
    id: 'list-folder-missing',
    route: 'GET /SASjsApi/drive/folder',
    description: 'refuses a listing of a folder that is not there',
    request: { query: { _folderPath: '/nope' } },
    expect: { status: 404, error: `Folder doesn't exist.` }
  },
  {
    id: 'delete-folder-without-path',
    route: 'DELETE /SASjsApi/drive/folder',
    description:
      'answers for a missing folder path, because the table marks it required',
    request: {},
    expect: { status: 400, error: '"_folderPath" is required' }
  },
  {
    id: 'create-folder-without-path',
    route: 'POST /SASjsApi/drive/folder',
    description: 'answers for a missing folder path in the body',
    request: { body: {} },
    expect: { status: 400, error: '"folderPath" is required' }
  },
  {
    id: 'create-folder',
    route: 'POST /SASjsApi/drive/folder',
    description: 'creates a folder',
    request: { body: { folderPath: '/data/reports' } },
    expect: { status: 200, body: success }
  },
  {
    id: 'create-folder-existing',
    route: 'POST /SASjsApi/drive/folder',
    description: 'refuses a folder that already exists, as 409',
    seed: { '/data/reports/a.csv': 'a' },
    request: { body: { folderPath: '/data/reports' } },
    expect: { status: 409, error: 'Folder already exists.' }
  },
  {
    id: 'delete-folder',
    route: 'DELETE /SASjsApi/drive/folder',
    description: 'deletes a folder with everything under it',
    seed: { '/data/reports/a.csv': 'a', '/data/reports/nested/b.csv': 'b' },
    request: { query: { _folderPath: '/data/reports' } },
    expect: { status: 200, body: success }
  },
  {
    id: 'delete-folder-missing',
    route: 'DELETE /SASjsApi/drive/folder',
    description: 'refuses a delete of a folder that is not there',
    request: { query: { _folderPath: '/nope' } },
    expect: { status: 404, error: `Folder doesn't exist.` }
  },
  {
    id: 'rename-file',
    route: 'POST /SASjsApi/drive/rename',
    description: 'moves a file to a new path',
    seed: { '/data/old.csv': 'r' },
    request: { body: { oldPath: '/data/old.csv', newPath: '/data/new.csv' } },
    expect: { status: 200, body: success }
  },
  {
    id: 'rename-onto-existing',
    route: 'POST /SASjsApi/drive/rename',
    description: 'refuses a move onto something that exists',
    seed: { '/data/a.csv': 'a', '/data/b.csv': 'b' },
    request: { body: { oldPath: '/data/a.csv', newPath: '/data/b.csv' } },
    expect: { status: 409, error: 'File with new name already exists.' }
  },
  {
    id: 'rename-missing',
    route: 'POST /SASjsApi/drive/rename',
    description: 'refuses a move of something that is not there',
    request: { body: { oldPath: '/data/nope.csv', newPath: '/data/x.csv' } },
    expect: { status: 404, error: 'No file/folder found for provided path.' }
  },
  {
    id: 'rename-folder-into-itself',
    route: 'POST /SASjsApi/drive/rename',
    description:
      'refuses a folder moved inside itself, which the server loses at the filesystem',
    seed: { '/data/reports/a.csv': 'a' },
    request: {
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
    request: { query: { _folderPath: '/data' } },
    expect: {
      status: 200,
      body: {
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
    id: 'bytes-round-trip',
    route: 'GET /SASjsApi/drive/file',
    description: 'keeps a byte file as bytes',
    seed: { '/data/pack.zip': bytes(80, 75, 3, 4) },
    request: { query: { _filePath: '/data/pack.zip' } },
    expect: { status: 200, contents: bytes(80, 75, 3, 4) }
  }
]
