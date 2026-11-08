/**
 * The provider configuration an administrator is allowed to read.
 *
 * `GET /SASjsApi/authConfig` exists so the administration interface can show
 * which external providers a host was started with. The values are the host's
 * environment; the decision this file owns is what may leave the process:
 *
 *   - only providers that are enabled appear, so the interface cannot offer to
 *     edit a provider the host does not have;
 *   - a secret is never echoed - the answer carries `LDAP_BIND_PASSWORD_SET` and
 *     `OIDC_CLIENT_SECRET_SET` (whether one is configured) and not the value.
 *     sasjs/server reads the bind password and the client secret from the
 *     environment and reports only those booleans, because this response is
 *     rendered into the admin page, the browser's state, the cache and any
 *     proxy log in the path;
 *   - a host that hands this service something shaped like a secret is refused
 *     by name rather than served, so a host cannot leak one through the route by
 *     naming a field the interface happens to render.
 *
 * The keys are the environment's own names (`LDAP_URL`, `OIDC_CLIENT_SECRET_SET`)
 * because that is what sasjs/server answers and what the admin page reads - a
 * translation here would be a second contract.
 */

/** What a host passes for LDAP; the booleans stand in for the secrets. */
export interface LdapProviderConfig {
  url: string
  bindDn: string
  usersBaseDn: string
  groupsBaseDn: string
  /** Whether a bind password is configured. The value itself must never be passed. */
  bindPasswordSet: boolean
}

export interface OidcProviderConfig {
  providerName: string
  issuerUrl: string
  clientId: string
  redirectUri: string
  scope: string
  signingAlg: string
  usernameClaim: string
  /** The host passes the variable through, so it stays a string here. */
  jitProvision: string
  /** Whether a client secret is configured. The value itself must never be passed. */
  clientSecretSet: boolean
}

export interface AuthConfig {
  ldap?: LdapProviderConfig
  oidc?: OidcProviderConfig
}

/** The body the route sends, with the environment's own key names. */
export interface AuthConfigResponse {
  ldap?: {
    LDAP_URL: string
    LDAP_BIND_DN: string
    LDAP_USERS_BASE_DN: string
    LDAP_GROUPS_BASE_DN: string
    LDAP_BIND_PASSWORD_SET: boolean
  }
  oidc?: {
    OIDC_PROVIDER_NAME: string
    OIDC_ISSUER_URL: string
    OIDC_CLIENT_ID: string
    OIDC_REDIRECT_URI: string
    OIDC_SCOPE: string
    OIDC_SIGNING_ALG: string
    OIDC_USERNAME_CLAIM: string
    OIDC_JIT_PROVISION: string
    OIDC_CLIENT_SECRET_SET: boolean
  }
}

export interface AuthConfigService {
  authConfig(): Promise<AuthConfigResponse>
}

/** The fields each provider block may carry, in the order the interface reads them. */
const LDAP_FIELDS: Array<keyof LdapProviderConfig> = [
  'url',
  'bindDn',
  'usersBaseDn',
  'groupsBaseDn',
  'bindPasswordSet'
]

const OIDC_FIELDS: Array<keyof OidcProviderConfig> = [
  'providerName',
  'issuerUrl',
  'clientId',
  'redirectUri',
  'scope',
  'signingAlg',
  'usernameClaim',
  'jitProvision',
  'clientSecretSet'
]

/**
 * Anything with one of these words in its name is a secret.
 *
 * The check is on the name rather than the value because the value is what a
 * host would have to hand over, and a host that hands it over has already lost:
 * this route is readable, logged and cached. `*Set` is the documented way to say
 * that one exists.
 */
const SECRET = /(password|secret|passwd|token)/i

const checkProvider = <T extends object>(
  name: string,
  block: T,
  fields: Array<keyof T & string>,
  booleans: Array<keyof T & string>
): void => {
  if (!block || typeof block !== 'object')
    throw new Error(
      `The auth configuration states \`${name}\` as ${JSON.stringify(block)}; a provider is an object, or absent when it is not enabled.`
    )

  for (const key of Object.keys(block)) {
    if (!fields.includes(key as keyof T & string))
      throw new Error(
        SECRET.test(key)
          ? `The auth configuration states \`${name}.${key}\`, which looks like a secret. Secrets are never echoed by this route: pass \`${key}Set: true\` instead, so the answer carries whether one is configured and not the value.`
          : `The auth configuration carries \`${name}.${key}\`, which the document's example does not state. Remove it, or add it to the provider's fields here and to the document.`
      )
  }

  for (const key of fields) {
    if (!(key in block))
      throw new Error(
        `The auth configuration does not state \`${name}.${key}\`, which the administration interface reads. State the empty string when the host has no value for it.`
      )

    const value = block[key]

    if (booleans.includes(key)) {
      if (typeof value !== 'boolean')
        throw new Error(
          `The auth configuration states \`${name}.${key}\` as ${JSON.stringify(value)}; it says whether the secret is configured, so it is a boolean.`
        )
    } else if (typeof value !== 'string')
      throw new Error(
        `The auth configuration states \`${name}.${key}\` as ${JSON.stringify(value)}; the document states a string.`
      )
  }
}

/**
 * The configuration, checked and rendered in the document's key names.
 *
 * Refusals are `Error` rather than `ApiError`: a host that passes a secret, or a
 * provider block with no fields, is misconfigured rather than answering a bad
 * request, and a `500` carrying its own configuration problem would blame the
 * caller.
 */
export const normaliseAuthConfig = (config: AuthConfig): AuthConfigResponse => {
  if (!config || typeof config !== 'object')
    throw new Error('The auth configuration is not an object.')

  for (const key of Object.keys(config))
    if (key !== 'ldap' && key !== 'oidc')
      throw new Error(
        SECRET.test(key)
          ? `The auth configuration states \`${key}\` at the top level, which looks like a secret. Secrets are never echoed by this route; put the provider under \`ldap\` or \`oidc\` and report whether the secret is set.`
          : `The auth configuration carries \`${key}\`, which is not a provider this API has. The document states \`ldap\` and \`oidc\`.`
      )

  const answer: AuthConfigResponse = {}

  if (config.ldap !== undefined) {
    checkProvider('ldap', config.ldap, LDAP_FIELDS, ['bindPasswordSet'])
    answer.ldap = {
      LDAP_URL: config.ldap.url,
      LDAP_BIND_DN: config.ldap.bindDn,
      LDAP_USERS_BASE_DN: config.ldap.usersBaseDn,
      LDAP_GROUPS_BASE_DN: config.ldap.groupsBaseDn,
      LDAP_BIND_PASSWORD_SET: config.ldap.bindPasswordSet
    }
  }

  if (config.oidc !== undefined) {
    checkProvider('oidc', config.oidc, OIDC_FIELDS, ['clientSecretSet'])
    answer.oidc = {
      OIDC_PROVIDER_NAME: config.oidc.providerName,
      OIDC_ISSUER_URL: config.oidc.issuerUrl,
      OIDC_CLIENT_ID: config.oidc.clientId,
      OIDC_REDIRECT_URI: config.oidc.redirectUri,
      OIDC_SCOPE: config.oidc.scope,
      OIDC_SIGNING_ALG: config.oidc.signingAlg,
      OIDC_USERNAME_CLAIM: config.oidc.usernameClaim,
      OIDC_JIT_PROVISION: config.oidc.jitProvision,
      OIDC_CLIENT_SECRET_SET: config.oidc.clientSecretSet
    }
  }

  // an empty object is the documented answer for a host with no external
  // provider, so it is not an error: the login screen then offers only the
  // local form
  return answer
}

/**
 * The auth-config service, over the host's own environment.
 *
 * A getter is accepted because the values are read from the environment and a
 * host can be reconfigured without a restart in some deployments; reading per
 * request keeps the answer true. The values never leave the process - only the
 * two `*_SET` booleans describe the secrets.
 */
export const createAuthConfigService = (
  config: AuthConfig | (() => AuthConfig)
): AuthConfigService => {
  const read = () => (typeof config === 'function' ? config() : config)

  return {
    async authConfig() {
      return normaliseAuthConfig(read())
    }
  }
}
