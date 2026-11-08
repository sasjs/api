import type { CorpusCase } from './drive.js'
import { BROWSER_INFO } from '../info/service.js'

/**
 * The info corpus: the answer the login screen reads before it has a caller.
 *
 * The case is pinned to the host this package ships (`BROWSER_INFO`), because a
 * corpus case runs against the services the runner builds, and the runner's host
 * is the browser one. What it proves is the shape every host must answer: every
 * required field present, `oidcProviderName` absent while no provider is
 * configured, and no property the document forbids - the browser build's own
 * `whiteList` and `protocol` were exactly that, on a public route.
 *
 * The server's own answer differs in its values, not its shape; `spec/info.spec`
 * drives that configuration through the same service.
 */
export const INFO_CORPUS: CorpusCase[] = [
  {
    id: 'info-answers-the-documented-shape',
    route: 'GET /SASjsApi/info',
    description:
      'answers the host configuration in the shape the document states, and no property it forbids',
    request: {},
    expect: { status: 200, body: BROWSER_INFO }
  }
]
