import type { CorpusCase } from './drive.js'

/**
 * The info corpus: the answer the login screen reads before it has a caller.
 *
 * The case pins the shape rather than the values, because the values belong to
 * the host: sasjs/server answers its mode, its real ports and its own build
 * version, and a browser build answers `null` ports and `js`. The members this
 * package ships are pinned in `spec/info.spec`, which drives a configuration;
 * what has to hold on every host is that the eight required properties are
 * present, `oidcProviderName` is there only when a provider is configured, and
 * nothing the document does not state travels with them - the browser build's
 * `whiteList` and `protocol` were exactly that, on a public route.
 */
export const INFO_CORPUS: CorpusCase[] = [
  {
    id: 'info-answers-the-documented-shape',
    route: 'GET /SASjsApi/info',
    description:
      'answers the host configuration in the shape the document states, and no property it forbids',
    request: {},
    expect: {
      status: 200,
      shape: {
        required: [
          'mode',
          'cors',
          'httpPort',
          'httpsPort',
          'runTimes',
          'authProviders',
          'localLoginEnabled',
          'version'
        ],
        // present only while oidc is a configured provider
        optional: ['oidcProviderName']
      }
    }
  }
]
