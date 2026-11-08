/**
 * `GET /SASjsApi/authConfig` - the non-secret provider configuration.
 *
 * The values are the host's environment; the decision under test is what may
 * leave the process. A secret that reaches this body reaches the admin page, the
 * browser's state, the cache and every proxy log in the path, so the service
 * refuses one by name rather than rendering it.
 */
import {
  createAuthConfigService,
  normaliseAuthConfig
} from '../src/authconfig/service.js'
import type { AuthConfig } from '../src/authconfig/service.js'
import { dispatch } from '../src/host/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { isApiError } from '../src/types.js'

const ldap = () => ({
  url: 'ldaps://my.ldap.server:636',
  bindDn: 'cn=admin,ou=system,dc=example',
  usersBaseDn: 'ou=users,dc=example',
  groupsBaseDn: 'ou=groups,dc=example',
  bindPasswordSet: true
})

const oidc = () => ({
  providerName: 'OpenID Connect',
  issuerUrl: 'https://idp.example/realms/sasjs',
  clientId: 'sasjs-server',
  redirectUri: 'https://sas.example/SASjsApi/auth/callback',
  scope: 'openid profile email',
  signingAlg: 'RS256',
  usernameClaim: 'preferred_username',
  jitProvision: 'true',
  clientSecretSet: true
})

const refusal = (run: () => unknown): string => {
  try {
    run()
    return 'resolved'
  } catch (error) {
    return (error as Error).message
  }
}

const drive = () => createDriveService(new MemoryDriveStore())

describe('the auth-config service', () => {
  it('answers both enabled providers under the environment key names', async () => {
    const answer = await createAuthConfigService({
      ldap: ldap(),
      oidc: oidc()
    }).authConfig()

    expect(answer).toEqual({
      ldap: {
        LDAP_URL: 'ldaps://my.ldap.server:636',
        LDAP_BIND_DN: 'cn=admin,ou=system,dc=example',
        LDAP_USERS_BASE_DN: 'ou=users,dc=example',
        LDAP_GROUPS_BASE_DN: 'ou=groups,dc=example',
        LDAP_BIND_PASSWORD_SET: true
      },
      oidc: {
        OIDC_PROVIDER_NAME: 'OpenID Connect',
        OIDC_ISSUER_URL: 'https://idp.example/realms/sasjs',
        OIDC_CLIENT_ID: 'sasjs-server',
        OIDC_REDIRECT_URI: 'https://sas.example/SASjsApi/auth/callback',
        OIDC_SCOPE: 'openid profile email',
        OIDC_SIGNING_ALG: 'RS256',
        OIDC_USERNAME_CLAIM: 'preferred_username',
        OIDC_JIT_PROVISION: 'true',
        OIDC_CLIENT_SECRET_SET: true
      }
    })
  })

  it('answers an empty object when no provider is enabled', async () => {
    // what the admin page renders as "no external providers" - and what the
    // login screen reads to offer only the local form
    expect(await createAuthConfigService({}).authConfig()).toEqual({})
  })

  it('answers only the provider that is enabled', async () => {
    const onlyLdap = await createAuthConfigService({
      ldap: ldap()
    }).authConfig()
    expect(onlyLdap.oidc).toBeUndefined()
    expect(Object.keys(onlyLdap)).toEqual(['ldap'])

    const onlyOidc = await createAuthConfigService({
      oidc: oidc()
    }).authConfig()
    expect(onlyOidc.ldap).toBeUndefined()
    expect(Object.keys(onlyOidc)).toEqual(['oidc'])
  })

  it('refuses a bind password or client secret by name', () => {
    // the two fields a host is most likely to reach for, because they are the
    // ones its environment holds
    expect(
      refusal(() =>
        normaliseAuthConfig({
          ldap: { ...ldap(), bindPassword: 'hunter2' } as never
        })
      )
    ).toContain('looks like a secret')

    expect(
      refusal(() =>
        normaliseAuthConfig({
          oidc: { ...oidc(), clientSecret: 'hunter2' } as never
        })
      )
    ).toContain('looks like a secret')

    expect(
      refusal(() => normaliseAuthConfig({ ldapPassword: 'hunter2' } as never))
    ).toContain('looks like a secret')
  })

  it('refuses a field, or a provider, the document does not state', () => {
    expect(
      refusal(() =>
        normaliseAuthConfig({ ldap: { ...ldap(), port: '636' } as never })
      )
    ).toContain('does not state')

    expect(refusal(() => normaliseAuthConfig({ saml: {} } as never))).toContain(
      'not a provider this API has'
    )

    expect(
      refusal(() => normaliseAuthConfig({ ldap: 'yes' } as never))
    ).toContain('a provider is an object, or absent')
  })

  it('refuses a provider block that omits a field the interface reads', () => {
    const broken = { ...ldap() } as Record<string, unknown>
    delete broken.bindDn

    expect(refusal(() => normaliseAuthConfig({ ldap: broken } as never))).toBe(
      'The auth configuration does not state `ldap.bindDn`, which the administration interface reads. State the empty string when the host has no value for it.'
    )
  })

  it('refuses the wrong type for a field or for a *Set boolean', () => {
    expect(
      refusal(() =>
        normaliseAuthConfig({ ldap: { ...ldap(), url: 636 } as never })
      )
    ).toContain('the document states a string')

    expect(
      refusal(() =>
        normaliseAuthConfig({
          ldap: { ...ldap(), bindPasswordSet: 'yes' } as never
        })
      )
    ).toContain('it says whether the secret is configured, so it is a boolean')

    expect(refusal(() => normaliseAuthConfig(null as never))).toBe(
      'The auth configuration is not an object.'
    )
  })

  it('reads the environment per call, so a provider enabled later is answered', async () => {
    const config: AuthConfig = {}
    const service = createAuthConfigService(() => config)

    expect(await service.authConfig()).toEqual({})

    config.ldap = ldap()
    expect((await service.authConfig()).ldap?.LDAP_BIND_PASSWORD_SET).toBe(true)
  })
})

describe('the auth-config route', () => {
  it('answers 200 with the enabled providers', async () => {
    const response = await dispatch(
      { drive: drive(), authConfig: createAuthConfigService({ ldap: ldap() }) },
      'GET /SASjsApi/authConfig'
    )

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      ldap: {
        LDAP_URL: 'ldaps://my.ldap.server:636',
        LDAP_BIND_DN: 'cn=admin,ou=system,dc=example',
        LDAP_USERS_BASE_DN: 'ou=users,dc=example',
        LDAP_GROUPS_BASE_DN: 'ou=groups,dc=example',
        LDAP_BIND_PASSWORD_SET: true
      }
    })
  })

  it('answers 501, naming the missing service, when the host supplies none', async () => {
    try {
      await dispatch({ drive: drive() }, 'GET /SASjsApi/authConfig')
      throw new Error('resolved')
    } catch (error) {
      expect(isApiError(error)).toBe(true)
      expect((error as { status: number }).status).toBe(501)
      expect((error as Error).message).toContain('has no auth-config service')
    }
  })
})
