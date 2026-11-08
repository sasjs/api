/**
 * The table's own integrity: it has to describe sasjs/server's API, agree with
 * what this package implements, and be usable as the matcher both hosts dispatch
 * with.
 */
import { ROUTES, findRoute, routeById } from '../src/routes/index.js'
import { OVERLAY } from '../src/routes/overlay.js'
import { HANDLED_ROUTES } from '../src/host/dispatch.js'
import { GENERATED_ROUTES } from '../src/routes/generated.js'

describe('route table', () => {
  it('covers every operation in the published document', () => {
    expect(GENERATED_ROUTES.length).toBe(61)
    expect(ROUTES.length).toBe(GENERATED_ROUTES.length)
    expect(new Set(ROUTES.map((route) => route.id)).size).toBe(ROUTES.length)
  })

  it('states a capability for every route, so a host can answer 501 with a reason', () => {
    expect(
      ROUTES.filter((route) => route.capabilities.length === 0).map((r) => r.id)
    ).toEqual([
      // public information and the health routes genuinely need nothing
      'GET /SASjsApi/info'
    ])
  })

  it('implements exactly what the dispatcher can answer', () => {
    const claimed = ROUTES.filter((route) => route.implemented)
      .map((route) => route.id)
      .sort()
    expect(claimed).toEqual([...HANDLED_ROUTES].sort())
  })

  it('implements every tag but the ones only a host can answer', () => {
    const implemented = ROUTES.filter((route) => route.implemented).map(
      (route) => route.tag
    )
    // every tag but Web, whose one operation - the bundle itself - is the
    // host's: serving files is not an API decision
    expect(new Set(implemented)).toEqual(
      new Set([
        'Drive',
        'Auth',
        'Web',
        'Session',
        'User',
        'Group',
        'Permission',
        'Client',
        'Info',
        'Code',
        'STP',
        'Admin',
        'Auth Config'
      ])
    )
  })

  it('carries the unpublish operation, and answers it', () => {
    const route = routeById('DELETE /SASjsApi/drive/deploy')

    // The pair that identifies a registry entry: a name alone is not enough,
    // because the same name republished for another folder is another app - which
    // is why the document requires both and answers 404 when the pair matches no
    // entry.
    expect(
      route?.params.map((param) => [param.name, param.in, param.required])
    ).toEqual([
      ['appLoc', 'body', true],
      ['streamServiceName', 'body', true]
    ])
    expect(route?.responses.map((response) => response.status)).toEqual([
      200, 400, 404
    ])

    // Unpublishing needs only the host's stream registry, which it supplies
    // through a port - so unlike the publish side it inverts, this one answers.
    expect(route?.implemented).toBe(true)
    expect(route?.capabilities).toEqual(['storage'])
  })

  it('states a decision for every operation in the document', () => {
    // Silence reads like "about to be done". The table refuses an operation with
    // no overlay entry at import, and this pins that as intended behaviour
    // rather than as a missing route.
    expect(
      GENERATED_ROUTES.filter((route) => !OVERLAY[route.id]).map((r) => r.id)
    ).toEqual([])

    for (const route of ROUTES) {
      if (route.implemented) expect(route.reason).toBeUndefined()
      else expect(route.reason).toBeTruthy()
    }
  })

  it('marks a host-only status only where the document states it', () => {
    // the annotation says who answers a status; it cannot add one
    for (const route of ROUTES)
      for (const status of route.hostResponses || [])
        expect({
          route: route.id,
          stated: route.responses.some((response) => response.status === status)
        }).toEqual({ route: route.id, stated: true })
  })

  it('does not hold an overlay entry the document has no operation for', () => {
    // the import throws in that case; this pins the throw as intended behaviour
    expect(() => {
      const known = new Set(ROUTES.map((route) => route.id))
      for (const id of Object.keys(OVERLAY)) expect(known.has(id)).toBe(true)
    }).not.toThrow()
  })

  describe('responses come from the document', () => {
    it('states exactly the statuses the document states, for every implemented route', () => {
      // structural today - `merge` takes the statuses from the document and throws
      // on an overlay entry naming one it does not state - and here so that
      // reintroducing a union shows up as a failure rather than as a status a host
      // advertises and nothing can observe. The behavioural half of the guard is
      // corpus-parity.spec.ts, which compares the document with what the cases
      // answer.
      // both sides sorted: the table orders statuses numerically and the
      // document keeps its own order, so comparing them as given would report
      // drift whenever the document lists 404 before 400
      const ascending = (statuses?: number[]) =>
        [...(statuses || [])].sort((a, b) => a - b)

      const drifted = ROUTES.filter((route) => route.implemented)
        .map((route) => ({
          id: route.id,
          table: ascending(route.responses.map((response) => response.status)),
          documented: ascending(
            GENERATED_ROUTES.find(
              (entry) => entry.id === route.id
            )?.responses.map((response) => response.status)
          )
        }))
        .filter(
          ({ table, documented }) =>
            JSON.stringify(table) !== JSON.stringify(documented)
        )

      expect(drifted).toEqual([])
    })

    it('annotates a refusal with the message a client reads', () => {
      const route = routeById('POST /SASjsApi/drive/file')

      // the string, not an envelope: the drive routes send the message as text
      expect(route?.responses.find((r) => r.status === 409)?.body).toEqual(
        'File already exists.'
      )
    })

    it('documents what the drive routes actually send', () => {
      // these three were wrong in the published document until sasjs/server#537;
      // the package reads them from the spec, so a regression there is a failure
      // here rather than a line in an overlay
      const statuses = (id: string) =>
        routeById(id)?.responses.map((response) => response.status)

      // the 400 is the validation refusal the implementation has always sent
      // (a path outside the drive, a blocked extension, a missing payload); the
      // document gained it in sasjs/server#538 rather than the table losing it
      expect(statuses('POST /SASjsApi/drive/file')).toEqual([200, 400, 409])
      expect(statuses('PATCH /SASjsApi/drive/file')).toEqual([200, 400, 404])
      expect(statuses('GET /SASjsApi/drive/file')).toEqual([200, 400, 404])
      expect(statuses('GET /SASjsApi/drive/folder')).toEqual([200, 400, 404])
    })
  })
})

describe('findRoute', () => {
  it('matches a static path exactly', () => {
    expect(findRoute('POST', '/SASjsApi/drive/file')?.route.id).toBe(
      'POST /SASjsApi/drive/file'
    )
  })

  it('ignores a trailing slash and the query string', () => {
    expect(findRoute('GET', '/SASjsApi/drive/filetree/')?.route.id).toBe(
      'GET /SASjsApi/drive/filetree'
    )
    expect(
      findRoute('GET', '/SASjsApi/drive/folder?_folderPath=/data')?.route.id
    ).toBe('GET /SASjsApi/drive/folder')
  })

  it('captures a path parameter', () => {
    const match = findRoute('GET', '/SASjsApi/user/by/username/sasdemo')

    expect(match?.route.id).toBe('GET /SASjsApi/user/by/username/{username}')
    expect(match?.params).toEqual({ username: 'sasdemo' })
  })

  it('decodes the captured value, and survives a malformed one', () => {
    expect(
      findRoute('GET', '/SASjsApi/user/' + encodeURIComponent('a b'))?.params
    ).toEqual({
      uid: 'a b'
    })
    expect(findRoute('GET', '/SASjsApi/user/%E0%A4%A')?.params).toEqual({
      uid: '%E0%A4%A'
    })
  })

  it('answers undefined for a method or path the API does not have', () => {
    expect(findRoute('GET', '/SASjsApi/nope')).toBeUndefined()
    expect(findRoute('PUT', '/SASjsApi/drive/file')).toBeUndefined()
  })

  it('matches a static path whatever its casing, as the host does', () => {
    // express's `case sensitive routing` is off by default and sasjs/server
    // never turns it on, so the server answers any casing the caller sends.
    // A matcher that compared the strings answered 404 where the server did
    // not - and the server's own front end asks for `fileTree`, a capital T
    // the document spells `filetree`.
    expect(findRoute('GET', '/SASjsApi/drive/fileTree')?.route.id).toBe(
      'GET /SASjsApi/drive/filetree'
    )
    expect(findRoute('GET', '/SASjsApi/drive/filetree')?.route.id).toBe(
      'GET /SASjsApi/drive/filetree'
    )
    expect(findRoute('GET', '/SASJSAPI/INFO')?.route.id).toBe(
      'GET /SASjsApi/info'
    )
  })

  it('captures a parameter without changing the case it was sent with', () => {
    // the static segments ignore case; the value does not - a host looks the
    // user or the file up by the name the client named.
    expect(
      findRoute('GET', '/SASjsApi/user/by/username/SasDemo')?.params
    ).toEqual({ username: 'SasDemo' })
    expect(findRoute('GET', '/SASjsApi/USER/AbC')?.params).toEqual({
      uid: 'AbC'
    })
  })

  it('holds no two paths that differ only by case', () => {
    // a case-insensitive matcher cannot tell such a pair apart, and the exact
    // map would keep whichever was inserted last - so the table must not
    // contain one
    const seen = new Map<string, string>()

    for (const route of ROUTES) {
      const key = route.method + ' ' + route.path.toLowerCase()
      expect({ key, clash: seen.get(key) }).toEqual({
        key,
        clash: undefined
      })
      seen.set(key, route.id)
    }
  })
})
