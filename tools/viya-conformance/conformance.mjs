#!/usr/bin/env node
/**
 * Drive @sasjs/adapter's own client against the emulator.
 *
 * The adapter's suite mocks axios, so it asserts the responses it was given
 * rather than the ones a server sends - pointing it at a server is not something
 * it can do. This is the other half: a real HTTP server answering every Viya path
 * from `dispatchViya`, with the adapter's `SASViyaApiClient` and
 * `SasjsRequestClient` used unchanged on the other side of the wire.
 *
 * Every defect this found was invisible to both suites before it:
 *
 *   - the adapter sends `//app` (root '/' joined to '/app'), which was a
 *     different path and therefore a different folder id;
 *   - a session body with only a `self` link fails, because the client polls the
 *     `rel: 'state'` link and fetches the `rel: 'log'` one;
 *   - a session stamped with a fixed instant is born expired, because the client
 *     computes its age against `sessionInactiveTimeout`;
 *   - the program arrives as an array of lines, not a string;
 *   - `/state` answers a bare enum, because the client calls `.trim()` on it.
 *
 * Usage:
 *
 *   npm run build && npm run conformance
 *   ADAPTER_PATH=/path/to/adapter npm run conformance
 */
import http from 'node:http'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const require = createRequire(import.meta.url)

const fail = (message) => {
  console.error(`\nconformance: ${message}`)
  process.exitCode = 1
}

const adapterPath =
  process.env.ADAPTER_PATH ?? path.resolve(root, 'node_modules/@sasjs/adapter')

if (!existsSync(adapterPath))
  fail(
    `no adapter at ${adapterPath}. Install @sasjs/adapter, or set ADAPTER_PATH to a clone with a build.`
  )

const api = await import(path.join(root, 'build/esm/index.js')).catch(() =>
  fail('the package is not built. Run `npm run build` first.')
)

const adapter = await import(path.join(adapterPath, 'build/index.js')).catch(
  (error) => fail(`cannot load the adapter at ${adapterPath}: ${error.message}`)
)

if (!api || !adapter) process.exit(1)

/** Every answer the server gave, so a failure can be read as a request list. */
const calls = []

const start = async () => {
  let services

  const server = http.createServer(async (request, response) => {
    let raw = ''

    for await (const chunk of request) raw += chunk

    const url = new URL(request.url, 'http://localhost')
    const query = Object.fromEntries(url.searchParams)
    const isJson = (request.headers['content-type'] ?? '').includes('json')

    let body

    try {
      body = raw && isJson ? JSON.parse(raw) : undefined
    } catch {
      body = undefined
    }

    let answer

    try {
      answer = await api.dispatchViya(services, request.method, url.pathname, {
        query,
        body,
        token: (request.headers.authorization ?? '').replace(/^Bearer /, '')
      })
    } catch (error) {
      answer = { status: 500, body: { message: error.message } }
    }

    calls.push({
      line: `${request.method} ${url.pathname}${url.search} -> ${answer.status}`,
      status: answer.status
    })

    const headers = { ...(answer.headers ?? {}) }
    // `contents` is the raw-body field; `body` is JSON
    const payload = answer.contents ?? answer.body
    const isText = typeof payload === 'string'

    headers['content-type'] =
      isText || answer.body === undefined
        ? (headers['content-type'] ?? 'text/plain')
        : 'application/json'

    response.writeHead(answer.status, headers)
    response.end(
      answer.body === undefined
        ? ''
        : isText
          ? answer.body
          : JSON.stringify(answer.body)
    )
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  const base = `http://127.0.0.1:${server.address().port}`

  services = {
    drive: api.createDriveService(new api.MemoryDriveStore()),
    identity: api.createIdentityService(
      new api.MemoryIdentityStore(api.DEFAULT_IDENTITY)
    ),
    viya: { serverUrl: base }
  }

  return { server, base }
}

const { server, base } = await start()

const client = new adapter.SASViyaApiClient(
  base,
  '/app',
  'Emulated Compute Context',
  new adapter.SasjsRequestClient(base)
)

const checks = []
const check = (name, condition, detail = '') =>
  checks.push({ name, ok: Boolean(condition), detail })

try {
  const contexts = await client.getComputeContexts('token')
  check(
    'reads the context list',
    Array.isArray(contexts) && contexts.length === 1,
    JSON.stringify(contexts).slice(0, 120)
  )

  const session = await client.createSession(
    'Emulated Compute Context',
    'token'
  )
  check(
    'creates a session the client accepts',
    Boolean(session?.id),
    session?.id
  )
  // the client expires a session by its age against sessionInactiveTimeout, so a
  // fixed emulated instant in the past is a session it discards on arrival
  const ageSeconds =
    (Date.now() - Date.parse(session?.creationTimeStamp ?? '')) / 1000

  check(
    'the session is not born expired',
    Number.isFinite(ageSeconds) && Math.abs(ageSeconds) < 60,
    `${Math.round(ageSeconds)}s old`
  )

  const folder = await client.createFolder('app', '/', undefined, 'token')
  check(
    'creates a folder the client can read back',
    Boolean(folder?.id),
    folder?.id
  )

  const job = await client.executeScript(
    '/app',
    ['data work.emulated; x = 1; run;'],
    'Emulated Compute Context',
    undefined,
    null,
    true,
    false,
    true
  )

  check('submits a job', Boolean(job?.job?.id), job?.job?.id)
  check(
    'polls it to completion',
    job?.job?.state === 'completed',
    job?.job?.state
  )
  check(
    'reads a generated log through the rel the client follows',
    typeof job?.log === 'string' &&
      job.log.includes('generated, not produced by SAS'),
    String(job?.log ?? '').slice(0, 80)
  )
} catch (error) {
  check('the flow completed', false, error.message)
} finally {
  server.close()
}

console.log(`\nconformance against ${base}\n`)

for (const { line } of calls) console.log(`  ${line}`)

console.log('')

let passed = 0

for (const { name, ok, detail } of checks) {
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`
  )

  if (ok) passed++
}

const unhealthy = calls.filter(({ status }) => status >= 500)

if (unhealthy.length) {
  console.log(`\n  ${unhealthy.length} server error(s):`)
  unhealthy.forEach(({ line }) => console.log(`    ${line}`))
  process.exitCode = 1
}

console.log(`\n  ${passed}/${checks.length} checks passed\n`)

if (passed !== checks.length) process.exitCode = 1
