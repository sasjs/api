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
    expect: { status: 404, error: 'No such app stream entry.' }
  }
]
