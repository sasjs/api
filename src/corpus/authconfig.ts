import type { CorpusCase } from './drive.js'
import type { AuthConfig } from '../authconfig/service.js'

/**
 * The provider configuration the corpus host states.
 *
 * A fixture rather than a value read from anywhere: the case asserts that the
 * route answers what the host holds, with the secrets reported as the two `*Set`
 * booleans and never as values.
 */
export const CORPUS_AUTH_CONFIG: AuthConfig = {
  ldap: {
    url: 'ldaps://directory.example:636',
    bindDn: 'cn=admin,dc=example',
    usersBaseDn: 'ou=users,dc=example',
    groupsBaseDn: 'ou=groups,dc=example',
    bindPasswordSet: true
  }
}

/** The body that fixture must answer with, environment key names and all. */
export const CORPUS_AUTH_CONFIG_BODY = {
  ldap: {
    LDAP_URL: 'ldaps://directory.example:636',
    LDAP_BIND_DN: 'cn=admin,dc=example',
    LDAP_USERS_BASE_DN: 'ou=users,dc=example',
    LDAP_GROUPS_BASE_DN: 'ou=groups,dc=example',
    LDAP_BIND_PASSWORD_SET: true
  }
}

/**
 * The auth-config corpus.
 *
 * The document states one status for this route - `200` - because the
 * administrator check is the host's mount point, and the overlay marks the `401`
 * and `500` it answers as host-only. What is pinned here is the body: the
 * environment's key names, the secret as a boolean, and no provider the host
 * did not enable.
 */
export const AUTH_CONFIG_CORPUS: CorpusCase[] = [
  {
    id: 'authconfig-answers-the-enabled-provider',
    route: 'GET /SASjsApi/authConfig',
    description:
      'answers the enabled provider with the secret reported as a boolean, never as a value',
    request: {},
    expect: { status: 200, body: CORPUS_AUTH_CONFIG_BODY }
  }
]
