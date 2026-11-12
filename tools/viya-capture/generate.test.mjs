import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeOperations,
  operationsOf,
  pathOf,
  renderCorpus,
  renderTable,
  shapeOf
} from './generate.mjs'

/**
 * A capture shaped like the recorder's output, generated here rather than
 * copied from a run: a real capture describes someone's estate, and a fixture
 * that carried its values would put them in the repository through the test
 * suite instead of through the table.
 *
 * `sense` varies every value and identifier, so a test can show that none of it
 * survives into the generated files.
 */
const capture = (sense = 1) => ({
  capturedAt: '2026-01-01T00:00:00.000Z',
  adapter: '6.0.2',
  steps: [
    {
      step: 'folders/item',
      request: {
        method: 'GET',
        path: '/folders/folders/@item',
        query: { path: `/Users/person-${sense}/app` },
        headers: { authorization: '<redacted>' }
      },
      response: {
        status: 200,
        body: JSON.stringify({
          id: `id-${sense}-0000-0000-0000-000000000000`,
          name: `app-${sense}`,
          memberCount: sense,
          links: [{ href: `/folders/folders/x${sense}`, rel: 'self' }]
        })
      }
    },
    {
      step: 'files/create',
      request: {
        method: 'POST',
        path: '/files/files',
        query: { parentFolderUri: `uri-${sense}` }
      },
      response: { status: 201, body: JSON.stringify({ id: `file-${sense}` }) }
    },
    {
      step: 'files/cleanup',
      cleanup: true,
      request: { method: 'DELETE', path: `/files/files/file-${sense}` },
      response: { status: 204 }
    }
  ]
})

test('an identifier in a path becomes a placeholder, a name does not', () => {
  assert.equal(
    pathOf('/folders/folders/3f2b1c9e-0a1b-4c2d-8e3f-4a5b6c7d8e9f/members'),
    '/folders/folders/{}/members'
  )
  assert.equal(pathOf('/folders/folders/@item'), '/folders/folders/@item')
  assert.equal(
    pathOf(
      '/compute/sessions/1234abcd-0000-4000-8000-000000000000-ses0000/state'
    ),
    '/compute/sessions/{}/state'
  )
})

test('a body becomes a shape, and a value never survives it', () => {
  const shape = shapeOf({
    id: 'the-estate-id',
    memberCount: 7,
    links: [{ href: 'https://estate.example.com/x', rel: 'self' }],
    nested: { deeper: { deepest: 'still not a value' } }
  })

  assert.deepEqual(shape, {
    id: 'string',
    links: [{ href: 'string', rel: 'string' }],
    memberCount: 'number',
    nested: { deeper: { deepest: 'string' } }
  })

  assert.equal(JSON.stringify(shape).includes('the-estate-id'), false)
})

test('an operation is METHOD and path, with its statuses accumulated', () => {
  const operations = operationsOf(capture())
  const item = operations.find(
    (operation) => operation.path === '/folders/folders/@item'
  )

  assert.equal(item.id, 'GET /folders/folders/@item')
  assert.deepEqual(item.statuses, [200])
  assert.deepEqual(item.steps, ['folders/item'])
  assert.deepEqual(item.queries, ['path'], 'the query name, never its value')
})

test('the recorder tidying up after itself is not an operation', () => {
  const operations = operationsOf(capture())

  assert.equal(
    operations.some((operation) =>
      operation.path.startsWith('/files/files/file-')
    ),
    false,
    'a cleanup request describes the recorder, not the client'
  )
})

test('several captures merge into one surface, in a stable order', () => {
  const merged = mergeOperations([
    operationsOf(capture(1)),
    operationsOf(capture(2))
  ])

  assert.deepEqual(
    merged.map((operation) => operation.id),
    ['POST /files/files', 'GET /folders/folders/@item']
  )

  assert.deepEqual(
    mergeOperations([operationsOf(capture(2)), operationsOf(capture(1))]).map(
      (operation) => operation.id
    ),
    merged.map((operation) => operation.id),
    'the order a run happened in does not change the table'
  )
})

test('the generated files are deterministic and carry no captured value', () => {
  const operations = operationsOf(capture(42))
  const table = renderTable(operations, 'V.04.00M0P100526')
  const corpus = renderCorpus(operations, 'V.04.00M0P100526')

  assert.equal(
    table,
    renderTable(operationsOf(capture(42)), 'V.04.00M0P100526')
  )

  for (const [name, source] of [
    ['table', table],
    ['corpus', corpus]
  ]) {
    for (const value of ['person-42', 'app-42', 'id-42', 'file-42', 'uri-42'])
      assert.equal(
        source.includes(value),
        false,
        `${name} carries a captured value: ${value}`
      )

    assert.equal(
      source.includes('V.04.00M0P100526'),
      true,
      `${name} names the pin`
    )
  }
})

test('a success after a refusal keeps the success, whichever 2xx it is', () => {
  // the first create is refused and the second answers 201; a test for exactly
  // 200 kept the 401 and its error shape as the operation's answer
  const operations = operationsOf({
    steps: [
      {
        step: 'files/create',
        request: { method: 'POST', path: '/files/files' },
        response: { status: 401, body: JSON.stringify({ message: 'denied' }) }
      },
      {
        step: 'files/create',
        request: { method: 'POST', path: '/files/files' },
        response: { status: 201, body: JSON.stringify({ id: 'the-file' }) }
      }
    ]
  })

  assert.equal(operations[0].expected, 201)
  assert.deepEqual(operations[0].statuses, [201, 401])
  assert.deepEqual(operations[0].shape, { id: 'string' })
})

test('a shape survives a run that recorded no body', () => {
  const withoutBody = operationsOf({
    steps: [
      {
        step: 'folders/item',
        request: { method: 'GET', path: '/folders/folders/@item' },
        response: { status: 200 }
      }
    ]
  })

  const withBody = operationsOf({
    steps: [
      {
        step: 'folders/item',
        request: { method: 'GET', path: '/folders/folders/@item' },
        response: {
          status: 200,
          body: JSON.stringify({ id: 'x', name: 'app' })
        }
      }
    ]
  })

  const merged = mergeOperations([withoutBody, withBody])

  assert.deepEqual(merged[0].shape, { id: 'string', name: 'string' })

  // and the other way round: the shape is not tied to which run came first
  assert.deepEqual(mergeOperations([withBody, withoutBody])[0].shape, {
    id: 'string',
    name: 'string'
  })
})

test('request query names are the union of the calls, like queries', () => {
  const first = operationsOf({
    steps: [
      {
        step: 'compute/contexts',
        request: {
          method: 'GET',
          path: '/compute/contexts',
          query: { limit: '1' }
        },
        response: { status: 200 }
      }
    ]
  })

  const second = operationsOf({
    steps: [
      {
        step: 'compute/context-by-name',
        request: {
          method: 'GET',
          path: '/compute/contexts',
          query: { filter: 'x' }
        },
        response: { status: 200 }
      }
    ]
  })

  const merged = mergeOperations([first, second])

  assert.deepEqual(merged[0].queries, ['filter', 'limit'])
  assert.deepEqual(
    merged[0].request.queries,
    ['filter', 'limit'],
    'a handler built from one row would omit a parameter with nothing marking it partial'
  )
})

test('a refusal carrying a body does not leave its error sketch on the success', () => {
  // the status and the shape come from the same observed answer: taking them
  // from different rows documents a 201 that answers `{ errorCode, message }`
  const refused = operationsOf({
    steps: [
      {
        step: 'files/create',
        request: { method: 'POST', path: '/files/files' },
        response: {
          status: 401,
          body: JSON.stringify({ errorCode: 401, message: 'denied' })
        }
      }
    ]
  })

  const created = operationsOf({
    steps: [
      {
        step: 'files/create',
        request: { method: 'POST', path: '/files/files' },
        response: {
          status: 201,
          body: JSON.stringify({ id: 'the-file', name: 'capture.txt' })
        }
      }
    ]
  })

  for (const merged of [
    mergeOperations([refused, created]),
    mergeOperations([created, refused])
  ]) {
    assert.equal(merged[0].expected, 201)
    assert.deepEqual(merged[0].shape, { id: 'string', name: 'string' })
  }
})

test('a form body is recorded as its parameter names, not as no body', () => {
  const [operation] = operationsOf({
    steps: [
      {
        step: 'auth/token-refresh',
        request: {
          method: 'POST',
          path: '/SASLogon/oauth/token',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=refresh_token&refresh_token=the-secret-value'
        },
        response: { status: 200, body: JSON.stringify({ access_token: 'x' }) }
      }
    ]
  })

  assert.deepEqual(operation.request.body, {
    form: ['grant_type', 'refresh_token']
  })
  assert.equal(
    JSON.stringify(operation).includes('the-secret-value'),
    false,
    'a parameter value is estate data'
  )
})

test('a multipart body is recorded as its part names', () => {
  const [operation] = operationsOf({
    steps: [
      {
        step: 'auth/token-refresh',
        request: {
          method: 'POST',
          path: '/SASLogon/oauth/token',
          headers: {
            'content-type':
              'multipart/form-data; boundary=--------------------------1234'
          },
          body:
            '----------------------------1234\r\n' +
            'Content-Disposition: form-data; name="grant_type"\r\n\r\n' +
            'refresh_token\r\n' +
            '----------------------------1234\r\n' +
            'Content-Disposition: form-data; name="refresh_token"\r\n\r\n' +
            'abc\r\n' +
            '----------------------------1234--'
        },
        response: { status: 200, body: JSON.stringify({ access_token: 'x' }) }
      }
    ]
  })

  assert.deepEqual(operation.request.body, {
    multipart: ['grant_type', 'refresh_token']
  })
})
