/**
 * The deploy routes' conformance corpus.
 *
 * `DELETE /SASjsApi/drive/deploy` documents three answers - `200`, `400` and
 * `404` - and each has a case here, which is what
 * `spec/corpus-parity.spec.ts` enforces in both directions.
 *
 * **The folder is the identity.** An app is one thing to deploy and one thing to
 * remove; its name is a label on it. The document requires both body values, so a
 * caller must supply both, but only the folder decides what is deleted - and the
 * case below with a stale name and the right folder pins exactly that, because a
 * name-keyed lookup would answer 404 there and leave the app in place.
 */
import type { CorpusCase } from './drive.js'

const SUBJECT = { userId: 'user-admin', clientId: 'web_app' }
/** A tree of `count` file members, for the deploy cap. */
const manyMembers = (count: number) =>
  Array.from({ length: count }, (_, at) => ({
    name: `file-${at}.txt`,
    type: 'file' as const,
    code: ''
  }))

export const DEPLOY_CORPUS: CorpusCase[] = [
  {
    id: 'deploy-unpublish',
    route: 'DELETE /SASjsApi/drive/deploy',
    description: 'removes a published app stream and answers the status',
    request: {
      subject: SUBJECT,
      body: { streamServiceName: 'myApp', appLoc: '/Public/myApp' }
    },
    expect: { status: 200, body: { status: 'success' } }
  },
  {
    id: 'deploy-unpublish-other-name',
    route: 'DELETE /SASjsApi/drive/deploy',
    description: 'removes the app by its folder when the name has been renamed',
    request: {
      subject: SUBJECT,
      body: { streamServiceName: 'renamed-app', appLoc: '/Public/myApp' }
    },
    expect: { status: 200, body: { status: 'success' } }
  },
  {
    id: 'deploy-unpublish-no-stream-name',
    route: 'DELETE /SASjsApi/drive/deploy',
    description: 'refuses a body that does not say which stream to remove',
    request: { subject: SUBJECT, body: { appLoc: '/Public/myApp' } },
    expect: { status: 400, error: '"streamServiceName" is required' }
  },
  {
    id: 'deploy-unpublish-no-app-loc',
    route: 'DELETE /SASjsApi/drive/deploy',
    description: 'refuses a body that does not say which folder to remove',
    request: { subject: SUBJECT, body: { streamServiceName: 'myApp' } },
    expect: { status: 400, error: '"appLoc" is required' }
  },
  {
    id: 'deploy-unpublish-unknown-folder',
    route: 'DELETE /SASjsApi/drive/deploy',
    description: 'answers 404 for a folder nothing is published at',
    request: {
      subject: SUBJECT,
      body: { streamServiceName: 'myApp', appLoc: '/Public/not-an-app' }
    },
    expect: { status: 404, error: 'No app is published at that folder.' }
  },

  // ------------------------------------------- the uploaded-archive route
  // The archive is expanded by the host, so what arrives here is the same tree
  // `POST /deploy` takes - which is why every answer below matches its twin.
  {
    id: 'upload-tree',
    route: 'POST /SASjsApi/drive/deploy/upload',
    description: 'writes the tree an uploaded archive expanded to',
    request: {
      subject: SUBJECT,
      body: {
        appLoc: '/Public/apps/uploaded',
        fileTree: {
          members: [
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
    id: 'upload-refused-by-shape',
    route: 'POST /SASjsApi/drive/deploy/upload',
    description: 'refuses an expansion that is not a tree',
    request: {
      subject: SUBJECT,
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
    id: 'upload-refused-by-entry-count',
    route: 'POST /SASjsApi/drive/deploy/upload',
    description: 'applies the deploy cap to the expanded tree, not the bytes',
    request: {
      subject: SUBJECT,
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
    id: 'upload-refused-by-store',
    route: 'POST /SASjsApi/drive/deploy/upload',
    description: 'answers the routes 500 when the drive refuses the write',
    unwritable: true,
    request: {
      subject: SUBJECT,
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
  }
]
