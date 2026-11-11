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
 *   VIYA_ALLOW_WRITES=1                  create and delete a file and a folder
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

const SECRET_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-xsrf-token'
]
const SECRET_KEYS = [
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'id_token',
  'client_secret',
  'clientsecret',
  'secret',
  'password',
  'code',
  'authorization',
  'cookie',
  'csrftoken'
]

const isSecretKey = (key) =>
  SECRET_KEYS.includes(
    String(key)
      .toLowerCase()
      .replace(/[\s_-]/g, '')
  )

const redacted = '<redacted>'

/** Replace every literal secret in a string, whatever the shape carried it in. */
const scrubLiterals = (text) => {
  let out = String(text)

  for (const secret of [CLIENT_SECRET, TOKEN, REFRESH_TOKEN])
    if (secret && secret.length > 8) out = out.split(secret).join(redacted)

  return out
}

/**
 * A body, with the values that carry a credential replaced.
 *
 * JSON is walked by key, so a token in a response body is replaced wherever it
 * sits. A form-encoded body is redacted by parameter name. Anything else - an
 * HTML login page, a SAS log - is only scrubbed for the literals this run knows,
 * because rewriting arbitrary text by pattern would corrupt the thing being
 * documented.
 */
const redactBody = (text, contentType = '') => {
  if (!text) return text

  const trimmed = text.trim()
  const type = String(contentType).toLowerCase()
  const looksJson = type.includes('json') || /^[[{]/.test(trimmed)

  if (looksJson) {
    try {
      const parsed = JSON.parse(trimmed)

      const walk = (value) => {
        if (Array.isArray(value)) return value.map(walk)

        if (value && typeof value === 'object')
          return Object.fromEntries(
            Object.entries(value).map(([key, inner]) => [
              key,
              isSecretKey(key) ? redacted : walk(inner)
            ])
          )

        return value
      }

      return scrubLiterals(JSON.stringify(walk(parsed)))
    } catch {
      return scrubLiterals(text)
    }
  }

  if (type.includes('x-www-form-urlencoded'))
    return scrubLiterals(
      trimmed.replace(
        /(^|&)([^=&]+)=([^&]*)/g,
        (match, separator, key) =>
          `${separator}${key}=${isSecretKey(key) ? redacted : '<value>'}`
      )
    )

  return scrubLiterals(text)
}

const STORED_HEADERS = [
  'content-type',
  'content-length',
  'location',
  'etag',
  'retry-after',
  'x-forcedotcom-instanceurl'
]

const storedHeaders = (headers) =>
  Object.fromEntries(
    Object.entries(headers ?? {})
      .filter(([key]) => STORED_HEADERS.includes(key.toLowerCase()))
      .map(([key, value]) => [key.toLowerCase(), String(value)])
  )

const record = (entry) => {
  captures.push({ step, ...entry })
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
                  SECRET_HEADERS.includes(key.toLowerCase())
                    ? redacted
                    : String(value)
                ])
              ),
              body: redactBody(requestBody, headers['content-type']),
              bodyBytes: Buffer.byteLength(requestBody)
            },
            response: {
              status: upstreamResponse.statusCode,
              headers: storedHeaders(upstreamResponse.headers),
              body: redactBody(
                responseBody.slice(0, 24000),
                upstreamResponse.headers['content-type']
              ),
              bodyBytes: Buffer.byteLength(responseBody)
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

if (ALLOW_WRITES && APP_LOC) {
  const folderName = `capture-${started}`

  await runStep('folders/create', () =>
    client.createFolder(`${APP_LOC}/${folderName}`, TOKEN)
  )

  await runStep('folders/delete', () =>
    client.deleteFolder(`${APP_LOC}/${folderName}`, TOKEN)
  )
}

proxy.close()

/* ------------------------------------------------------------------- output */

const redactJson = (value) =>
  redactBody(JSON.stringify(value), 'application/json')

const outDir = join(here, 'capture')
mkdirSync(outDir, { recursive: true })

const outFile = join(outDir, `viya-capture-${started}.json`)

writeFileSync(
  outFile,
  redactJson({
    capturedAt: new Date().toISOString(),
    node: process.version,
    adapter: require('@sasjs/adapter/package.json').version,
    estate: '<estate>',
    context: CONTEXT || null,
    appLoc: APP_LOC || null,
    allowExecute: ALLOW_EXECUTE,
    allowWrites: ALLOW_WRITES,
    steps: captures
  }),
  'utf8'
)

const statuses = captures.reduce((counts, entry) => {
  const status = entry.response?.status ?? 'transport-error'

  counts[status] = (counts[status] ?? 0) + 1

  return counts
}, {})

console.log(
  `\n${captures.length} requests recorded -> ${outFile}\nstatuses: ${JSON.stringify(statuses)}`
)
