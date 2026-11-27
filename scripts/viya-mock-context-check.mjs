import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const captureRequire = createRequire(
  new URL('../tools/viya-capture/package.json', import.meta.url)
)
const SASjs = captureRequire('@sasjs/adapter/node').default
const api = require('../build/cjs/index.js')

// Loopback transport exercises the pinned adapter and the built emulator; it
// does not contact Viya or execute SAS.
test('the adapter selects the explicitly configured mock context from an unfiltered list', async (t) => {
  const requests = []
  const services = { drive: api.createDriveService(new api.MemoryDriveStore()) }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    requests.push(`${req.method} ${url.pathname}${url.search}`)
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString()
    const answer = await api.dispatchViya(services, req.method, url.pathname, {
      query: Object.fromEntries(url.searchParams),
      body: raw ? JSON.parse(raw) : undefined
    })
    res.writeHead(answer.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(answer.body))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const serverUrl = `http://127.0.0.1:${server.address().port}`
  const configured = new SASjs({
    serverUrl,
    serverType: 'SASVIYA',
    contextName: 'SASjs Mock context'
  })
  const session =
    await configured.sasViyaApiClient.sessionManager.createAndWaitForSession()
  assert.equal(session.state, 'idle')
  assert.match(session.id, /^[0-9a-f-]{36}$/)
  assert.equal(requests[0], 'GET /compute/contexts?limit=10000')
  const contexts = await api.dispatchViya(services, 'GET', '/compute/contexts')
  assert.deepEqual(requests, [
    'GET /compute/contexts?limit=10000',
    `POST /compute/contexts/${contexts.body.items[0].id}/sessions`
  ])

  const withoutOverride = new SASjs({ serverUrl, serverType: 'SASVIYA' })
  await assert.rejects(
    withoutOverride.sasViyaApiClient.sessionManager.createAndWaitForSession(),
    /The context 'SAS Job Execution compute context' was not found/
  )
  assert.deepEqual(requests.slice(2), ['GET /compute/contexts?limit=10000'])
  const wrongContext = new SASjs({
    serverUrl,
    serverType: 'SASVIYA',
    contextName: 'Other context'
  })
  await assert.rejects(
    wrongContext.sasViyaApiClient.sessionManager.createAndWaitForSession(),
    /The context 'Other context' was not found/
  )
  assert.equal(requests[3], 'GET /compute/contexts?limit=10000')

  const found = await configured.getComputeContextByName('SASjs Mock context')
  assert.equal(found.id, contexts.body.items[0].id)
  assert.equal(found.name, contexts.body.items[0].name)
  const detail = await configured.getComputeContextById(found.id)
  assert.equal(detail.id, found.id)
  assert.equal(detail.name, found.name)
  await assert.rejects(
    configured.getComputeContextByName('Other context'),
    /The context 'Other context' was not found/
  )
  assert.deepEqual(
    requests.slice(4).map((r) => decodeURIComponent(r)),
    [
      'GET /compute/contexts?filter=eq(name, "SASjs Mock context")',
      `GET /compute/contexts/${found.id}`,
      'GET /compute/contexts?filter=eq(name, "Other context")'
    ]
  )
})
