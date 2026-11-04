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
    expect(GENERATED_ROUTES.length).toBe(60)
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

  it('carries the implementation status of the drive, and nothing else yet', () => {
    const implemented = ROUTES.filter((route) => route.implemented).map(
      (route) => route.tag
    )
    expect(new Set(implemented)).toEqual(new Set(['Drive']))
  })

  it('does not hold an overlay entry the document has no operation for', () => {
    // the import throws in that case; this pins the throw as intended behaviour
    expect(() => {
      const known = new Set(ROUTES.map((route) => route.id))
      for (const id of Object.keys(OVERLAY)) expect(known.has(id)).toBe(true)
    }).not.toThrow()
  })

  describe('where the document and the implementation disagree', () => {
    it('states 409 for a create over a file that exists, not the documented 403', () => {
      const route = routeById('POST /SASjsApi/drive/file')

      expect(route?.responses.map((r) => r.status)).toEqual([200, 409])
      // the string, not an envelope: the drive routes send the message as text
      expect(route?.responses.find((r) => r.status === 409)?.body).toEqual(
        'File already exists.'
      )
      expect(OVERLAY['POST /SASjsApi/drive/file'].correction).toMatch(/403/)
    })

    it('states 404 for a replace of a file that is missing, not the documented 403', () => {
      const route = routeById('PATCH /SASjsApi/drive/file')

      expect(route?.responses.map((r) => r.status)).toEqual([200, 404])
      expect(OVERLAY['PATCH /SASjsApi/drive/file'].correction).toMatch(/404/)
    })

    it('states 200 for a file read, not the documented 204', () => {
      const route = routeById('GET /SASjsApi/drive/file')

      expect(route?.responses.map((r) => r.status)).toEqual([200])
      expect(OVERLAY['GET /SASjsApi/drive/file'].correction).toMatch(/204/)
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
})
