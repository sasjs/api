#!/usr/bin/env node
/**
 * Records what the adapter sends to a Viya estate, and what comes back.
 *
 * The adapter is the client the emulator has to satisfy, so the adapter is what
 * this script drives: it is pointed at a local proxy, the proxy forwards every
 * request to the estate and stores the pair. Nothing about the request shapes is
 * transcribed here, which is the whole point - a capture made from a hand-written
 * request would describe my guess rather than the client.
 *
 * Credentials never reach the file: request and response headers are redacted by
 * name, bodies have secret-bearing values replaced, and the access token and
 * client secret are additionally scrubbed as literals wherever they appear.
 *
 * Usage (Node 18 or newer):
 *
 *   npm install
 *   VIYA_URL=https://estate.example.com \
 *   VIYA_TOKEN=<access token> \
 *   VIYA_CONTEXT='SAS Job Execution compute context' \
 *   VIYA_APP_LOC=/Public/myapp \
 *   node capture.mjs
 *
 * Optional:
 *
 *   VIYA_CLIENT_ID / VIYA_CLIENT_SECRET  record the token endpoint as well
 *   VIYA_REFRESH_TOKEN                   record the refresh grant
 *   VIYA_ALLOW_EXECUTE=1                 create a session and run a program
 *   VIYA_ALLOW_WRITES=1                  create and delete one folder
 *   VIYA_ALLOW_FILES=1                   create, read and replace one file
 *   VIYA_TLS_RELAX=1                     accept a self-signed certificate
 *   CAPTURE_PORT=8899                    local proxy port
 *
 * Output: capture/viya-capture-<timestamp>.json, plus a one-line summary printed
 * at the end. Send that file back; it holds no credentials.
 */

import http from 'node:http'
import https from 'node:https'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// The package exports the client classes but not the request client that a
// stand-alone `SASViyaApiClient` needs, so the instance is built through the
// adapter itself and its own client objects are reused. They are members rather
// than exports, which keeps this file from transcribing any request shape.
const Adapter = require('@sasjs/adapter/node').default

import {
  ESTATE,
  REDACTED,
  createScrubber,
  findLeaks,
  isSecretHeader,
  redactAndCap,
  redactAuthorization,
  redactBody
} from './redact.mjs'
import {
  executePass,
  filePass,
  folderNameFor,
  folderPass,
  removeFolder
} from './pass.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.CAPTURE_PORT ?? 8899)
const TARGET = process.env.VIYA_URL
const TOKEN = process.env.VIYA_TOKEN ?? ''
const CLIENT_ID = process.env.VIYA_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.VIYA_CLIENT_SECRET ?? ''
const REFRESH_TOKEN = process.env.VIYA_REFRESH_TOKEN ?? ''
const CONTEXT = process.env.VIYA_CONTEXT ?? ''
const APP_LOC = process.env.VIYA_APP_LOC ?? ''
const ALLOW_EXECUTE = process.env.VIYA_ALLOW_EXECUTE === '1'
const ALLOW_WRITES = process.env.VIYA_ALLOW_WRITES === '1'
const ALLOW_FILES = process.env.VIYA_ALLOW_FILES === '1'
const TLS_RELAX = process.env.VIYA_TLS_RELAX === '1'

if (!TARGET) {
  console.error(
    'VIYA_URL is required, for example VIYA_URL=https://estate.example.com'
  )
  process.exit(2)
}

const upstream = new URL(TARGET)
const transport = upstream.protocol === 'http:' ? http : https

/* ------------------------------------------------------------------ capture */

const captures = []
let step = 'startup'

/**
 * True while a step is removing what an earlier step created. Its requests are
 * still recorded - the file is a log of the run - but they are marked, because
 * a delete performed for tidiness is not part of the client's surface and must
 * not reach the generated table.
 */
let cleanup = false

/**
 * One scrubber for the run: the estate's names and this run's secrets. Every
 * string that reaches the file goes through it, so a link in a body and an
 * address in an error message leave the same way.
 */
const scrub = createScrubber({
  origin: upstream.origin,
  host: upstream.hostname,
  secrets: [CLIENT_SECRET, TOKEN, REFRESH_TOKEN]
})

const STORED_HEADERS = [
  'content-type',
  'content-length',
  'location',
  'etag',
  'retry-after'
]

const storedHeaders = (headers) =>
  Object.fromEntries(
    Object.entries(headers ?? {})
      .filter(([key]) => STORED_HEADERS.includes(key.toLowerCase()))
      .map(([key, value]) => [key.toLowerCase(), scrub(String(value))])
  )

const record = (entry) => {
  captures.push({ step, ...(cleanup ? { cleanup: true } : {}), ...entry })
}

/* -------------------------------------------------------------------- proxy */

const proxy = http.createServer((req, res) => {
  const chunks = []

  req.on('data', (chunk) => chunks.push(chunk))

  req.on('end', () => {
    const requestBody = Buffer.concat(chunks).toString('utf8')
    const started = Date.now()

    const headers = { ...req.headers, host: upstream.host }

    delete headers['content-length']
    if (requestBody) headers['content-length'] = Buffer.byteLength(requestBody)

    const forwarded = transport.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || undefined,
        path: req.url,
        method: req.method,
        headers,
        ...(TLS_RELAX ? { rejectUnauthorized: false } : {})
      },
      (upstreamResponse) => {
        const parts = []

        upstreamResponse.on('data', (chunk) => parts.push(chunk))

        upstreamResponse.on('end', () => {
          const responseBody = Buffer.concat(parts).toString('utf8')

          // redact, then cap: a cap applied first cuts JSON mid-token, the parse
          // fails, and the fallback cannot know a `password` field
          const response = redactAndCap(
            responseBody,
            upstreamResponse.headers['content-type'],
            scrub
          )

          record({
            request: {
              method: req.method,
              path: req.url.split('?')[0],
              query: String(req.url).includes('?')
                ? Object.fromEntries(new URL(req.url, 'http://x').searchParams)
                : undefined,
              headers: Object.fromEntries(
                Object.entries(headers).map(([key, value]) => [
                  key,
                  // the scheme is the part a reader diagnoses with: the token
                  // steps use Basic and every other call uses Bearer
                  isSecretHeader(key)
                    ? scrub(redactAuthorization(value))
                    : scrub(String(value))
                ])
              ),
              body: redactBody(requestBody, headers['content-type'], scrub),
              bodyBytes: Buffer.byteLength(requestBody)
            },
            response: {
              status: upstreamResponse.statusCode,
              headers: storedHeaders(upstreamResponse.headers),
              body: response.body,
              bodyBytes: Buffer.byteLength(responseBody),
              bodyTruncated: response.truncated
            },
            ms: Date.now() - started
          })

          res.writeHead(
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.headers
          )
          res.end(Buffer.concat(parts))
        })
      }
    )

    forwarded.on('error', (error) => {
      record({
        request: { method: req.method, path: req.url.split('?')[0] },
        response: { status: null, error: String(error).slice(0, 400) },
        ms: Date.now() - started
      })

      res.writeHead(502, { 'content-type': 'text/plain' })
      res.end(String(error))
    })

    if (requestBody) forwarded.write(requestBody)

    forwarded.end()
  })
})

/* -------------------------------------------------------------------- steps */

const runStep = async (name, action) => {
  step = name

  try {
    const result = await action()

    console.log(`  ${name}: ok`)
    return result
  } catch (error) {
    // a refusal is a capture too: the emulator has to answer the same status
    console.log(`  ${name}: ${String(error?.message ?? error).slice(0, 160)}`)
    return undefined
  }
}

/**
 * A step that removes what the pass created.
 *
 * Kept apart from `runStep` because the two say different things: a refused
 * cleanup is a warning about the run, not a captured contract, and its requests
 * carry the `cleanup` marker so the generator passes over them.
 */
const runCleanup = async (name, action) => {
  step = name
  cleanup = true

  try {
    await action()
    console.log(`  ${name}: ok`)
  } catch (error) {
    console.log(
      `  ${name}: ${String(error?.message ?? error).slice(0, 160)} (left behind)`
    )
  } finally {
    cleanup = false
  }
}

const started = Date.now()

await new Promise((resolve) => proxy.listen(PORT, '127.0.0.1', resolve))

console.log(`Recording ${upstream.origin} through 127.0.0.1:${PORT}`)

const proxyUrl = `http://127.0.0.1:${PORT}`
const sasjs = new Adapter({
  serverUrl: proxyUrl,
  appLoc: APP_LOC,
  serverType: 'SASVIYA',
  contextName: CONTEXT,
  useComputeApi: true,
  debug: false
})

const requestClient = sasjs.requestClient
const client = sasjs.sasViyaApiClient

const basicAuth = (clientId, clientSecret) =>
  'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

if (CLIENT_ID && CLIENT_SECRET) {
  await runStep('auth/token-client-credentials', () =>
    requestClient.post(
      '/SASLogon/oauth/token',
      'grant_type=client_credentials',
      undefined,
      'application/x-www-form-urlencoded',
      {
        Authorization: basicAuth(CLIENT_ID, CLIENT_SECRET),
        Accept: 'application/json'
      }
    )
  )

  // the same call with a wrong secret: the refusal shape matters as much as the
  // success, and the emulator has to answer it identically
  await runStep('auth/token-bad-secret', () =>
    requestClient.post(
      '/SASLogon/oauth/token',
      'grant_type=client_credentials',
      undefined,
      'application/x-www-form-urlencoded',
      {
        Authorization: basicAuth(CLIENT_ID, `${CLIENT_SECRET}-wrong`),
        Accept: 'application/json'
      }
    )
  )
}

if (REFRESH_TOKEN && CLIENT_ID && CLIENT_SECRET) {
  await runStep('auth/token-refresh', () =>
    requestClient.post(
      '/SASLogon/oauth/token',
      'grant_type=refresh_token&refresh_token=' +
        encodeURIComponent(REFRESH_TOKEN),
      undefined,
      'application/x-www-form-urlencoded',
      {
        Authorization: basicAuth(CLIENT_ID, CLIENT_SECRET),
        Accept: 'application/json'
      }
    )
  )
}

await runStep('identities/current-user', () =>
  requestClient.get('/identities/users/@currentUser', TOKEN)
)

await runStep('compute/contexts', () => client.getComputeContexts(TOKEN))

if (CONTEXT)
  await runStep('compute/context-by-name', () =>
    client.getComputeContextByName(CONTEXT, TOKEN)
  )

if (APP_LOC) {
  await runStep('folders/item', () => client.getFolder(APP_LOC, TOKEN))
  await runStep('folders/members', () => client.listFolder(APP_LOC, TOKEN))
}

if (ALLOW_EXECUTE && CONTEXT) {
  const session = await runStep('compute/session-create', () =>
    client.createSession(CONTEXT, TOKEN)
  )

  if (session?.id) {
    await runStep('compute/session-state', () =>
      requestClient.get(`/compute/sessions/${session.id}/state`, TOKEN)
    )

    await runStep('compute/session-delete', () =>
      requestClient.delete(`/compute/sessions/${session.id}`, TOKEN)
    )
  }
}

if (ALLOW_WRITES || ALLOW_FILES) {
  if (APP_LOC) {
    const folderName = folderNameFor(started)

    const { folderPath } = await folderPass({
      client,
      token: TOKEN,
      appLoc: APP_LOC,
      folderName,
      runStep
    })

    if (ALLOW_FILES)
      await filePass({
        client,
        requestClient,
        token: TOKEN,
        folderPath,
        fileName: `${folderName}.txt`,
        runStep,
        runCleanup
      })

    // Remove the folder after the file inside it, because the estate refuses to
    // delete a folder that still has members (11516) - there is no recursive
    // delete to fall back on.
    await removeFolder({ client, token: TOKEN, folderPath, runCleanup })
  } else console.log('  folders/create: skipped, VIYA_APP_LOC is not set')
}

// Last, because the adapter treats a fresh one-hour token as expiring and
// refreshes it before the job is submitted: the refresh rotates the pair, so
// every step that needs `TOKEN` runs before this one.
if (ALLOW_EXECUTE && CONTEXT) {
  const executed = await executePass({
    client,
    authConfig: {
      access_token: TOKEN,
      ...(REFRESH_TOKEN ? { refresh_token: REFRESH_TOKEN } : {})
    },
    contextName: CONTEXT,
    runStep
  })

  // the version the capture was taken against, said out loud rather than
  // remembered: it is what VIYA_TARGET_VERSION is pinned to
  const version = String(executed?.log ?? '').match(/SYSVLONG=\s*(.+)/)?.[1]

  console.log(
    version
      ? `  version: ${version.trim()}`
      : '  version: not in the log, the execute step did not return one'
  )
}

proxy.close()

/* ------------------------------------------------------------------- output */

const document = {
  capturedAt: new Date().toISOString(),
  node: process.version,
  adapter: require('@sasjs/adapter/package.json').version,
  estate: ESTATE,
  context: CONTEXT || null,
  appLoc: APP_LOC ? '<appLoc>' : null,
  allowExecute: ALLOW_EXECUTE,
  allowWrites: ALLOW_WRITES,
  allowFiles: ALLOW_FILES,
  steps: captures
}

const payload = redactBody(JSON.stringify(document), 'application/json', scrub)

// The scrubber is a filter, not a proof: it replaces what it knows. This is the
// second opinion, and it runs on the finished text - a host in a link, a token
// the run never held, an address in an error message. Nothing sensitive is left
// on disk when it fails.
const leaks = findLeaks(payload, {
  host: upstream.hostname,
  secrets: [CLIENT_SECRET, TOKEN, REFRESH_TOKEN]
})

if (leaks.length) {
  console.error(
    '\nRefusing to write the capture. It still carries: ' +
      leaks.map((leak) => `${leak.category} (${leak.count})`).join(', ') +
      '\nNothing was written. Please send this output rather than the file.'
  )
  process.exit(3)
}

const outDir = join(here, 'capture')
mkdirSync(outDir, { recursive: true })

const outFile = join(outDir, `viya-capture-${started}.json`)

writeFileSync(outFile, payload, 'utf8')

const statuses = captures.reduce((counts, entry) => {
  const status = entry.response?.status ?? 'transport-error'

  counts[status] = (counts[status] ?? 0) + 1

  return counts
}, {})

const cleaned = captures.filter((entry) => entry.cleanup).length

console.log(
  `\n${captures.length} requests recorded -> ${outFile}\nstatuses: ${JSON.stringify(statuses)}` +
    (cleaned ? `\ncleanup requests, kept out of the table: ${cleaned}` : '')
)
