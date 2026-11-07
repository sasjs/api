/**
 * The deploy routes' conformance corpus.
 *
 * `DELETE /SASjsApi/drive/deploy` documents three answers - `200`, `400` and
 * `404` - and each has a case here, which is what
 * `spec/corpus-parity.spec.ts` enforces in both directions.
 *
 * The body carries two values, and both are refused when missing: a caller that
 * names the stream but not where it is published has not said what to remove.
 * The `404` covers a name that was never published *and* a name published
 * somewhere else, because both mean "there is no such entry" to the caller.
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
    id: 'deploy-unpublish-no-stream-name',
    route: 'DELETE /SASjsApi/drive/deploy',
    description: 'refuses a body that does not say which stream to remove',
    request: { subject: SUBJECT, body: { appLoc: '/Public/myApp' } },
    expect: { status: 400, error: '"streamServiceName" is required' }
  },
  {
    id: 'deploy-unpublish-no-app-loc',
    route: 'DELETE /SASjsApi/drive/deploy',
    description:
      'refuses a body that does not say where the stream is published',
    request: { subject: SUBJECT, body: { streamServiceName: 'myApp' } },
    expect: { status: 400, error: '"appLoc" is required' }
  },
  {
    id: 'deploy-unpublish-unknown-stream',
    route: 'DELETE /SASjsApi/drive/deploy',
    description: 'answers 404 for a stream nobody published',
    request: {
      subject: SUBJECT,
      body: { streamServiceName: 'not-an-app', appLoc: '/Public/not-an-app' }
    },
    expect: { status: 404, error: 'No such app stream entry.' }
  },
  {
    id: 'deploy-unpublish-wrong-app-loc',
    route: 'DELETE /SASjsApi/drive/deploy',
    description: 'answers 404 when the name is published somewhere else',
    request: {
      subject: SUBJECT,
      body: { streamServiceName: 'myApp', appLoc: '/Public/other' }
    },
    expect: { status: 404, error: 'No such app stream entry.' }
  }
]
