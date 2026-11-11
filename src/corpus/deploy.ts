/**
 * The deploy routes' conformance corpus.
 *
 * `DELETE /SASjsApi/drive/deploy` documents three answers - `200`, `400` and
 * `404` - and each has a case here, which is what
 * `spec/corpus-parity.spec.ts` enforces in both directions.
 *
 * **The id is the identity.** An app is one thing to deploy and one thing to
 * remove, and the id a publish returns is the handle: a label is shared by design
 * and a folder is where the app was published rather than what it is. The case
 * below removes an app whose label has since changed, by id alone, which a
 * name-keyed or folder-keyed lookup could not do.
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
    description: 'removes the app the id names, and says what went',
    request: {
      subject: SUBJECT,
      body: { id: '6f1c1c1e-6a1e-4c4a-9d1a-1b2c3d4e5f60' }
    },
    expect: {
      status: 200,
      partial: {
        status: 'success',
        app: { id: '6f1c1c1e-6a1e-4c4a-9d1a-1b2c3d4e5f60', name: 'myApp' }
      }
    }
  },
  {
    id: 'deploy-unpublish-no-id',
    route: 'DELETE /SASjsApi/drive/deploy',
    description: 'refuses a body that does not say which app to remove',
    request: { subject: SUBJECT, body: {} },
    expect: { status: 400, error: '"id" is required' }
  },
  {
    id: 'deploy-unpublish-unknown-id',
    route: 'DELETE /SASjsApi/drive/deploy',
    description: 'answers 404 for an id the index does not hold',
    request: {
      subject: SUBJECT,
      body: { id: '11111111-1111-4111-8111-111111111111' }
    },
    expect: { status: 404, error: 'No app is published with that id.' }
  },

  // ------------------------------------------- the uploaded-archive route
  // The archive is expanded by the host, so what arrives here is the same tree
  // `POST /deploy` takes - which is why every answer below matches its twin. The
  // folder and the stream are stated in the QUERY, where the document puts them on
  // this route: the body is the archive. A host that receives an archive builds it
  // from the tree below; the tree is what the archive has to expand to.
  {
    id: 'upload-tree',
    route: 'POST /SASjsApi/drive/deploy/upload',
    description: 'writes the tree an uploaded archive expanded to',
    request: {
      subject: SUBJECT,
      query: { appLoc: '/Public/apps/uploaded' },
      body: {
        fileTree: {
          members: [
            {
              name: 'index.html',
              type: 'file',
              code: 'PGgxPkhlbGxvPC9oMT4=',
              encoding: 'base64'
            }
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
    id: 'upload-query-fields',
    route: 'POST /SASjsApi/drive/deploy/upload',
    description:
      'takes the folder and the stream from the query, where the document states them',
    request: {
      subject: SUBJECT,
      query: { appLoc: '/Public/apps/from-query', streamWebFolder: 'web' },
      body: {
        fileTree: {
          members: [
            {
              name: 'services',
              type: 'folder',
              members: [
                {
                  name: 'web',
                  type: 'folder',
                  members: [
                    { name: 'index.html', type: 'file', code: '<h1>Hello</h1>' }
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    expect: {
      status: 200,
      partial: {
        status: 'success',
        app: { name: 'from-query' }
      }
    }
  },
  {
    id: 'deploy-refuses-a-tree-without-its-web-folder',
    route: 'POST /SASjsApi/drive/deploy',
    description:
      'refuses a stream the tree does not carry, rather than indexing an app that would answer 404',
    request: {
      subject: SUBJECT,
      body: {
        appLoc: '/Public/apps/no-web',
        streamWebFolder: 'web',
        fileTree: {
          members: [
            { name: 'index.html', type: 'file', code: '<h1>Hello</h1>' }
          ]
        }
      }
    },
    expect: {
      status: 400,
      error:
        'The deployed tree has no "services/web" folder, so nothing would be published at /Public/apps/no-web. Deploy the web assets under services/web, or omit streamWebFolder.'
    }
  },
  {
    id: 'upload-text-file',
    route: 'POST /SASjsApi/drive/deploy/upload',
    description:
      'writes a file member as its own text when no encoding is stated',
    request: {
      subject: SUBJECT,
      query: { appLoc: '/Public/apps/text' },
      body: {
        fileTree: {
          members: [
            { name: 'index.html', type: 'file', code: '<h1>Hello</h1>' }
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
    // no archive expands to this: only a host handed an expansion can send it
    transport: 'expansion',
    request: {
      subject: SUBJECT,
      query: { appLoc: '/Public/apps/bad' },
      body: { fileTree: { members: 1 } }
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
      query: { appLoc: '/Public/apps/many' },
      body: {
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

  // ------------------------------------------- a bundle that is an app
  // One deploy writes the tree and indexes the app, from the manifest at the
  // root of the archive. The id is minted, so the case pins what can be pinned:
  // the app exists, under the label the manifest states.
  {
    id: 'deploy-publishes-an-app',
    route: 'POST /SASjsApi/drive/deploy',
    description:
      'indexes a bundle as an app from the manifest it carries, in one request',
    request: {
      subject: SUBJECT,
      body: {
        appLoc: '/Public/apps/mario',
        fileTree: {
          members: [
            {
              name: 'sasjs.app.json',
              type: 'file',
              code: JSON.stringify({
                name: 'Mario',
                streamWebFolder: 'web',
                logo: 'logo.png'
              })
            },
            {
              name: 'services',
              type: 'folder',
              members: [
                {
                  name: 'web',
                  type: 'folder',
                  members: [
                    { name: 'index.html', type: 'file', code: '<h1>Mario</h1>' }
                  ]
                },
                { name: 'run', type: 'service', code: '%put hi;' }
              ]
            }
          ]
        }
      }
    },
    expect: {
      status: 200,
      partial: {
        status: 'success',
        app: { name: 'Mario' }
      }
    }
  },
  {
    id: 'deploy-refuses-a-bad-manifest',
    route: 'POST /SASjsApi/drive/deploy',
    description: 'refuses a bundle whose manifest is not JSON',
    request: {
      subject: SUBJECT,
      body: {
        appLoc: '/Public/apps/bad-manifest',
        fileTree: {
          members: [{ name: 'sasjs.app.json', type: 'file', code: '{not json' }]
        }
      }
    },
    expect: {
      status: 400
    }
  },
  {
    id: 'upload-refused-by-store',
    route: 'POST /SASjsApi/drive/deploy/upload',
    description: 'answers the routes 500 when the drive refuses the write',
    unwritable: true,
    request: {
      subject: SUBJECT,
      query: { appLoc: '/Public/apps/demo' },
      body: {
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
    id: 'upload-replaces-the-folder',
    route: 'POST /SASjsApi/drive/deploy/upload',
    description:
      "an archive upload is the folder's whole contents, so a file it drops is gone",
    seed: {
      '/Public/apps/replaced/services/web/old.html': '<h1>old</h1>'
    },
    request: {
      subject: SUBJECT,
      query: { appLoc: '/Public/apps/replaced', streamWebFolder: 'web' },
      body: {
        fileTree: {
          members: [
            {
              name: 'services',
              type: 'folder',
              members: [
                {
                  name: 'web',
                  type: 'folder',
                  members: [
                    { name: 'index.html', type: 'file', code: '<h1>new</h1>' }
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    expect: {
      status: 200,
      partial: { status: 'success', app: { name: 'replaced' } }
    },
    expectDrive: {
      present: ['/Public/apps/replaced/services/web/index.html'],
      missing: ['/Public/apps/replaced/services/web/old.html']
    }
  },
  {
    id: 'deploy-keeps-what-is-there',
    route: 'POST /SASjsApi/drive/deploy',
    description:
      'the JSON route writes over what is there unless it is told to replace',
    seed: {
      '/Public/apps/kept/old.html': '<h1>old</h1>'
    },
    request: {
      subject: SUBJECT,
      body: {
        appLoc: '/Public/apps/kept',
        fileTree: {
          members: [{ name: 'a.html', type: 'file', code: '<h1>a</h1>' }]
        }
      }
    },
    expect: { status: 200 },
    expectDrive: {
      present: ['/Public/apps/kept/a.html', '/Public/apps/kept/old.html']
    }
  }
]
