import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REDACTED,
  ESTATE,
  createScrubber,
  findLeaks,
  isSecretHeader,
  isSecretKey,
  redactBody,
  redactHeaders
} from './redact.mjs'

const run = {
  origin: 'https://estate.example.com',
  host: 'estate.example.com',
  secrets: ['the-client-secret', 'the-access-token-abcdef']
}

const scrub = createScrubber(run)

test('a link keeps its shape and loses the estate', () => {
  assert.equal(
    scrub('{"href":"https://estate.example.com/folders/folders/abc"}'),
    `{"href":"https://${ESTATE}/folders/folders/abc"}`
  )
})

test('a bare host is replaced wherever it appears', () => {
  assert.equal(
    scrub('Error at estate.example.com:443 while polling'),
    `Error at ${ESTATE}:443 while polling`
  )
})

test('a secret is redacted, not named', () => {
  assert.equal(scrub('x=the-client-secret'), `x=${REDACTED}`)
  assert.equal(scrub('Bearer the-access-token-abcdef').includes(REDACTED), true)
})

test('the longest literal wins, so a secret containing another is not half-replaced', () => {
  const s = createScrubber({ secrets: ['abc', 'abc-longer'] })

  assert.equal(s('abc-longer'), REDACTED)
})

test('secret-bearing parameter names are known in every spelling', () => {
  for (const key of [
    'authorization',
    'client_secret',
    'clientSecret',
    'refresh_token',
    'refreshToken',
    'access_token',
    'id_token',
    'code',
    'password',
    'cookie',
    'x-csrf-token'
  ])
    assert.equal(isSecretKey(key), true, key)

  for (const key of ['grant_type', 'Accept', 'client_id', 'username', 'limit'])
    assert.equal(isSecretKey(key), false, key)

  assert.equal(isSecretHeader('Authorization'), true)
  assert.equal(isSecretHeader('accept'), false)
})

test('headers keep the scheme and lose the credential', () => {
  assert.deepEqual(
    redactHeaders({
      Authorization: 'Basic dGVzdDp0ZXN0',
      Accept: 'application/json',
      Cookie: 'sas-session=abc'
    }),
    {
      Authorization: 'Basic <redacted>',
      Accept: 'application/json',
      Cookie: REDACTED
    }
  )
})

test('a JSON body is walked, so a token in a nested field is replaced', () => {
  const body = redactBody(
    JSON.stringify({
      access_token: 'the-access-token-abcdef',
      data: [{ refresh_token: 'r3fr3sh', name: 'app' }],
      count: 1
    }),
    'application/json',
    scrub
  )

  assert.equal(body.includes('the-access-token-abcdef'), false)
  assert.equal(body.includes('r3fr3sh'), false)
  assert.match(body, /"name":"app"/)
})

test('a form body is redacted by parameter and keeps the rest', () => {
  const body = redactBody(
    'grant_type=client_credentials&client_secret=the-client-secret',
    'application/x-www-form-urlencoded',
    scrub
  )

  assert.equal(body.includes('the-client-secret'), false)
  assert.match(body, /grant_type=<value>/)
})

test('an HTML body is scrubbed but not rewritten', () => {
  const html =
    '<form action="https://estate.example.com/SASLogon/login.do" method="post"><input name="username"></form>'

  const body = redactBody(html, 'text/html', scrub)

  assert.equal(body.includes('estate.example.com'), false)
  assert.match(body, /<form action=/)
  assert.match(body, /<input name="username">/)
})

test('the verifier names the category and counts, never the value', () => {
  const leaks = findLeaks(
    'see https://estate.example.com/x for the-client-secret and 10.11.12.13',
    run
  )

  const categories = leaks.map((leak) => leak.category).sort()

  assert.deepEqual(categories, ['address', 'credential', 'estate-host'])
  assert.equal(JSON.stringify(leaks).includes('the-client-secret'), false)
  assert.equal(JSON.stringify(leaks).includes('10.11.12.13'), false)
})

test('a token-shaped value is caught even when the run never saw it', () => {
  const leaks = findLeaks(
    'Authorization: Bearer eyJqa3V6aWwuZXhhbXBsZS5jb20.someotherpart',
    run
  )

  assert.deepEqual(
    leaks.map((leak) => leak.category),
    ['token-shaped-value']
  )
})

test('a clean capture verifies clean, and loopback is not an address to report', () => {
  const clean = JSON.stringify({
    estate: ESTATE,
    steps: [
      {
        request: {
          path: '/compute/contexts',
          headers: { authorization: REDACTED }
        },
        response: { status: 200, body: '{"items":[]}' }
      }
    ],
    note: 'recorded through 127.0.0.1:8899'
  })

  assert.deepEqual(findLeaks(clean, run), [])
})
