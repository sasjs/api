/**
 * The replay both hosts run: the corpus turned into requests, and the answers
 * compared with what the estate captured.
 *
 * These cases are the helper's own contract, not a host's: a host that reports a
 * drift the helper cannot produce, or a helper that invents an id, would make
 * every host's replay lie in the same way.
 */
import { requestFor, shapeMismatches } from '../src/corpus/viya/replay.js'
import type { ViyaCase } from '../src/corpus/viya/operations.js'

const viyaCase = (over: Partial<ViyaCase>): ViyaCase => ({
  route: 'GET /folders/folders/@item',
  step: 'folders/at-root',
  queries: [],
  statuses: [200],
  expected: 200,
  ...over
})

describe('the replay request', () => {
  it('fills a hole with the id named by the segment before it', () => {
    const request = requestFor(
      viyaCase({ route: 'GET /compute/sessions/{}/jobs/{}' }),
      { session: 'session-1', job: 'job-1' }
    )

    expect(request.path).toBe('/compute/sessions/session-1/jobs/job-1')
    expect(request.unresolved).toEqual([])
  })

  it.each([
    '29750292-3B61-4038-97A9-E8595AC73D99-ses0000',
    'opaque-session-ID'
  ])('preserves an externally supplied session ID (%s) verbatim', (session) => {
    const request = requestFor(
      viyaCase({ route: 'GET /compute/sessions/{}/state' }),
      { session }
    )

    expect(request.path).toBe(`/compute/sessions/${session}/state`)
    expect(request.unresolved).toEqual([])
  })

  it('reports a hole it has no id for rather than filling it', () => {
    const request = requestFor(
      viyaCase({ route: 'GET /compute/sessions/{}/state' }),
      {}
    )

    // a path built from a placeholder would answer a 404 that says nothing about
    // the contract, which is the failure mode this report exists to prevent
    expect(request.unresolved).toEqual(['session'])
    expect(request.path).toBe('/compute/sessions/{}/state')
  })

  it('keys the two holes of one path separately', () => {
    const request = requestFor(
      viyaCase({ route: 'GET /compute/sessions/{}/variables/{}' }),
      { session: 'session-1', variable: 'SYSCC' }
    )

    expect(request.path).toBe('/compute/sessions/session-1/variables/SYSCC')
  })

  it('appends the query values a caller supplies, and names the ones it did not', () => {
    const request = requestFor(
      viyaCase({
        route: 'GET /folders/folders/@item',
        queries: ['path', 'limit']
      }),
      {},
      { path: '/Public' }
    )

    expect(request.path).toBe('/folders/folders/@item?path=%2FPublic')
    // `limit` is optional to the estate, so omitting it is not a failure - but the
    // caller is told, so a case whose answer depends on it cannot be skipped by
    // accident
    expect(request.omittedQueries).toEqual(['limit'])
  })

  it('reads a route from the corpus as it is written', () => {
    const request = requestFor(
      viyaCase({ route: 'DELETE /compute/sessions/{}' }),
      { session: 'session-1' }
    )

    expect(request.method).toBe('DELETE')
    expect(request.path).toBe('/compute/sessions/session-1')
  })

  it('takes no state and no query values at all', () => {
    // a case with neither is the common shape of a first read, and the caller
    // should not have to pass empty objects to use it
    const request = requestFor(viyaCase({}))

    expect(request.path).toBe('/folders/folders/@item')
    expect(request.unresolved).toEqual([])
    expect(request.omittedQueries).toEqual([])
  })

  it('joins a query onto one the route template already carries', () => {
    const request = requestFor(
      viyaCase({ route: 'GET /folders/folders/@item?x=1', queries: ['path'] }),
      {},
      { path: '/' }
    )

    expect(request.path).toBe('/folders/folders/@item?x=1&path=%2F')
  })

  it('names a hole by its own segment when the segment is one it does not know', () => {
    // nothing in the corpus has a hole there today, but a case added later must
    // fail loudly rather than look up an id under a key nobody sets
    const request = requestFor(viyaCase({ route: 'GET /odd/{}/thing' }), {
      odd: 'odd-1'
    })

    expect(request.path).toBe('/odd/odd-1/thing')
    expect(request.unresolved).toEqual([])
  })
})

describe('the shape comparison', () => {
  it('passes a body that carries every captured key with its type', () => {
    const shape = { count: 'number', items: [{ id: 'string' }] }

    expect(
      shapeMismatches(shape, { count: 2, items: [{ id: 'a' }, { id: 'b' }] })
    ).toEqual([])
  })

  it('names the key an answer left out', () => {
    expect(
      shapeMismatches({ count: 'number', items: [] }, { count: 1 })
    ).toEqual(['body.items: missing from the answer'])
  })

  it('names a type the answer changed', () => {
    expect(shapeMismatches({ count: 'number' }, { count: '1' })).toEqual([
      'body.count: expected number, got string'
    ])
  })

  it('descends into an array whose element the answer carried', () => {
    expect(shapeMismatches([{ id: 'string' }], [{ id: 1 }])).toEqual([
      'body[0].id: expected string, got number'
    ])
  })

  it('passes an empty array, because an element cannot be demonstrated', () => {
    // the alternative is a replay that fails on an empty drive, which says
    // nothing about the shape - the estate's own capture had an element
    expect(shapeMismatches([{ id: 'string' }], [])).toEqual([])
  })

  it('passes an empty recorded element shape, which has nothing to compare', () => {
    // the capture records containers with no element shape (`properties: []` in a
    // job definition), and a non-empty answer compared against `undefined` would
    // report "expected undefined, got object" - drift no host could act on
    expect(shapeMismatches([], [{ id: 'string' }])).toEqual([])
    expect(shapeMismatches({ tags: [] }, { tags: ['a'] })).toEqual([])
  })

  it('treats object as the depth cap the capture wrote it as', () => {
    expect(shapeMismatches('object', { anything: true })).toEqual([])
    expect(shapeMismatches('object', 'a string')).toEqual([
      'body: expected an object, got string'
    ])
  })

  it('matches the array leaf the corpus records on a job definition', () => {
    // `properties: 'array'` is a real captured leaf, and `typeof` never answers
    // 'array' - an array is 'object' - so a comparison without this branch could
    // never pass and would report "expected array, got array"
    expect(
      shapeMismatches({ properties: 'array' }, { properties: [] })
    ).toEqual([])
    expect(
      shapeMismatches({ properties: 'array' }, { properties: {} })
    ).toEqual(['body.properties: expected an array, got object'])
  })

  it('refuses null where the capture recorded an object or an array', () => {
    // a JSON answer of `null` is not an object with no keys: a client reading a
    // field off it throws, so the replay has to name it
    expect(shapeMismatches({ count: 'number' }, null)).toEqual([
      'body: expected an object, got null'
    ])
    expect(shapeMismatches([{ id: 'string' }], null)).toEqual([
      'body: expected an array, got null'
    ])
    // and an array where the capture recorded an object is named as an array, not
    // as `object`
    expect(shapeMismatches({ count: 'number' }, [])).toEqual([
      'body: expected an object, got array'
    ])
  })

  it('reports every disagreement in one run', () => {
    const shape = {
      count: 'number',
      items: [{ id: 'string' }],
      start: 'number'
    }

    expect(shapeMismatches(shape, { count: 1, items: [{ id: 2 }] })).toEqual([
      'body.items[0].id: expected string, got number',
      'body.start: missing from the answer'
    ])
  })
})
