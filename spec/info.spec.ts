/**
 * `GET /SASjsApi/info` - the public answer the login screen reads first.
 *
 * The values are the host's, so what this pins is the shape: every field the
 * document requires, no field it forbids, and the two derivations sasjs/server
 * performs. The two answers this replaces are the server's and the browser
 * build's, and their disagreement is the reason the route is here at all - the
 * worker answered `{ mode, cors, whiteList, protocol, runTimes }` while the
 * document states eight required properties and no `whiteList`.
 */
import {
  BROWSER_INFO,
  createInfoService,
  normaliseInfo
} from '../src/info/service.js'
import type { InfoResponse } from '../src/info/service.js'
import { dispatch } from '../src/host/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { isApiError } from '../src/types.js'
import { routeById } from '../src/routes/index.js'

/** The shape sasjs/server answers in desktop mode, with nothing configured. */
const serverInfo = (): InfoResponse => ({
  mode: 'server',
  cors: 'disable',
  httpPort: 5000,
  httpsPort: 443,
  runTimes: ['sas', 'js'],
  authProviders: [],
  localLoginEnabled: true,
  version: 'v4.16.1 (1a784eb)'
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

describe('the info service', () => {
  it('answers the documented fields, in the document order', async () => {
    const info = await createInfoService(serverInfo()).info()

    expect(info).toEqual(serverInfo())
    expect(Object.keys(info)).toEqual([
      'mode',
      'cors',
      'httpPort',
      'httpsPort',
      'runTimes',
      'authProviders',
      'localLoginEnabled',
      'version'
    ])
  })

  it('answers the browser host with no listener, no provider and no local login', async () => {
    // the shape the service worker this package ships must answer: the document
    // requires both ports, so a host with none says null rather than dropping
    // them, and says local login is off rather than letting the screen offer a
    // form nothing verifies
    expect(await createInfoService(BROWSER_INFO).info()).toEqual({
      mode: 'desktop',
      cors: 'disable',
      httpPort: null,
      httpsPort: null,
      runTimes: ['js'],
      authProviders: [],
      localLoginEnabled: false,
      version: 'dev'
    })
  })

  it('includes the sign-on label only while oidc is a configured provider', async () => {
    // sasjs/server reads the label from OIDC_PROVIDER_NAME and includes it only
    // when the provider is on; a screen that offered a button for a provider the
    // server does not hold would send the user to a refusal
    const off = await createInfoService({
      ...serverInfo(),
      oidcProviderName: 'OpenID Connect'
    }).info()
    expect(off.oidcProviderName).toBeUndefined()
    expect(Object.keys(off)).not.toContain('oidcProviderName')

    const on = await createInfoService({
      ...serverInfo(),
      authProviders: ['oidc'],
      oidcProviderName: 'OpenID Connect'
    }).info()
    expect(on.oidcProviderName).toBe('OpenID Connect')
  })

  it('drops a repeated run time or provider rather than serving it twice', async () => {
    const info = await createInfoService({
      ...serverInfo(),
      runTimes: ['sas', 'js', 'sas'],
      authProviders: ['ldap', 'ldap']
    }).info()

    expect(info.runTimes).toEqual(['sas', 'js'])
    expect(info.authProviders).toEqual(['ldap'])
  })

  it('reads the configuration per call, so a run time added after boot is answered', async () => {
    const config = serverInfo()
    const service = createInfoService(() => config)

    expect((await service.info()).runTimes).toEqual(['sas', 'js'])

    config.runTimes = ['sas', 'js', 'py']
    expect((await service.info()).runTimes).toEqual(['sas', 'js', 'py'])
  })

  it('answers `cors` and `mode` as the document states them - strings, verbatim', async () => {
    // the server passes `CORS` and `MODE` through, and the document states both
    // as `{type: string}`, so a host whose environment says `disabled` is
    // answered rather than refused. sasjs/server#593 types both as enums and
    // publishes them; the refusal tightens when that release is vendored here.
    const info = await createInfoService({
      ...serverInfo(),
      mode: 'banana',
      cors: 'disabled'
    }).info()

    expect({ mode: info.mode, cors: info.cors }).toEqual({
      mode: 'banana',
      cors: 'disabled'
    })
  })

  it('refuses a `mode`, `cors` or `version` that is empty or not a string', () => {
    for (const field of ['mode', 'cors', 'version'] as const) {
      expect({
        field,
        empty: refusal(() => normaliseInfo({ ...serverInfo(), [field]: '' }))
      }).toEqual({
        field,
        empty: expect.stringContaining(`states ${field} as ""`)
      })
      expect({
        field,
        wrong: refusal(() =>
          normaliseInfo({ ...serverInfo(), [field]: 7 as never })
        )
      }).toEqual({
        field,
        wrong: expect.stringContaining(`states ${field} as 7`)
      })
    }
  })

  it('refuses a property the document does not state, because the route is public', () => {
    for (const extra of [
      { whiteList: [] as string[] },
      { protocol: 'browser' },
      { cors: 'disable', ports: { http: 5000 } as unknown }
    ]) {
      const message = refusal(() =>
        normaliseInfo({ ...serverInfo(), ...extra } as InfoResponse)
      )
      expect(message).toContain(
        "which the document's InfoResponse does not state"
      )
    }

    expect(
      refusal(() => normaliseInfo({ ...serverInfo(), whiteList: [] } as never))
    ).toContain('`whiteList`')
  })

  it('refuses a required field it does not state, by name', () => {
    for (const field of [
      'mode',
      'cors',
      'httpPort',
      'httpsPort',
      'runTimes',
      'authProviders',
      'localLoginEnabled',
      'version'
    ]) {
      const config = { ...serverInfo() } as Record<string, unknown>
      delete config[field]

      const message = refusal(() => normaliseInfo(config as never))
      expect({ field, message }).toEqual({
        field,
        message: expect.stringContaining(`does not state \`${field}\``)
      })
    }
  })

  it('refuses a port that is not an integer in range, and reads 0 as a bug', () => {
    // the server answers null for a listener it did not start; 0 is a different
    // statement, and collapsing it into null is how a client prints port 0
    for (const port of [
      0,
      -1,
      3.5,
      65536,
      Number.NaN,
      '80' as unknown as number
    ])
      expect(
        refusal(() => normaliseInfo({ ...serverInfo(), httpPort: port }))
      ).toContain('a port is')

    expect(
      refusal(() => normaliseInfo({ ...serverInfo(), httpsPort: 443.5 }))
    ).toContain('a port is an integer')
  })

  it("refuses an answer that is not the document's types", () => {
    expect(
      refusal(() => normaliseInfo({ ...serverInfo(), mode: '' }))
    ).toContain('which mode the host runs in')
    expect(
      refusal(() => normaliseInfo({ ...serverInfo(), mode: 3 as never }))
    ).toContain('which mode the host runs in')
    expect(
      refusal(() =>
        normaliseInfo({ ...serverInfo(), runTimes: 'sas' as never })
      )
    ).toContain('an array of strings')
    expect(
      refusal(() => normaliseInfo({ ...serverInfo(), runTimes: ['sas', ''] }))
    ).toContain('not a name')
    expect(
      refusal(() =>
        normaliseInfo({ ...serverInfo(), localLoginEnabled: 'yes' as never })
      )
    ).toContain('the document states a boolean')
    expect(
      refusal(() =>
        normaliseInfo({ ...serverInfo(), oidcProviderName: 42 as never })
      )
    ).toContain("the sign-on button's label")
  })

  it('refuses a configuration that is not an object', () => {
    expect(refusal(() => normaliseInfo(undefined as never))).toBe(
      'The info configuration is not an object.'
    )
  })
})

describe('the info route', () => {
  it('is carried, and annotated with a body the document states', () => {
    const route = routeById('GET /SASjsApi/info')

    expect(route?.implemented).toBe(true)
    expect(route?.reason).toBeUndefined()
    expect(route?.responses).toEqual([
      {
        status: 200,
        description: 'Ok',
        body: {
          mode: 'server',
          cors: 'disable',
          httpPort: 5000,
          httpsPort: 443,
          runTimes: ['sas', 'js'],
          authProviders: [],
          localLoginEnabled: true,
          version: 'v3.2.2 (4a26a3d)'
        }
      }
    ])
  })

  it('answers 200 with the host configuration', async () => {
    const response = await dispatch(
      { drive: drive(), info: createInfoService(serverInfo()) },
      'GET /SASjsApi/info'
    )

    expect(response).toEqual({ status: 200, body: serverInfo() })
  })

  it('answers 501, naming the missing service, when the host supplies none', async () => {
    try {
      await dispatch({ drive: drive() }, 'GET /SASjsApi/info')
      throw new Error('resolved')
    } catch (error) {
      expect(isApiError(error)).toBe(true)
      expect((error as { status: number }).status).toBe(501)
      expect((error as Error).message).toContain('has no info service')
    }
  })

  it('needs no caller: it is public and pre-auth', async () => {
    // no identity service at all, which is the state of a host whose login
    // screen has not been used yet - the route must still answer
    const response = await dispatch(
      { drive: drive(), info: createInfoService(BROWSER_INFO) },
      'GET /SASjsApi/info',
      {}
    )

    expect(response.status).toBe(200)
  })
})
