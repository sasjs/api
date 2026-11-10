/**
 * The app stream as a web surface: the listing, the landing page, the apps, and
 * the removal of one - decided once for every host.
 *
 * This is not part of the REST API document, because it is not a JSON API: a
 * browser opens these URLs, and an app's own files are served from them
 * (`GET /app/<id>/main.js`). What the hosts must agree on is the part that was
 * written twice before: what the listing says, what a missing app answers, how an
 * asset is found inside a deployment, and what is cacheable. So it lives here,
 * and a host mounts it:
 *
 *   - sasjs/server mounts it behind its own authentication and permission rules,
 *     passing `allow` so a caller sees only the apps it holds a grant on;
 *   - the browser build answers it from the drive it already has, so a mock site
 *     publishes, lists and serves its apps exactly as the server does.
 *
 * The base path is `/app`. An app is addressed by its id - `/app/<id>/` - which is
 * the whole reason the id is a UUID and not a label: two apps may share a name,
 * and neither the URL nor the lookup has to care.
 */
import { ApiError } from '../types.js'
import type { DriveService } from '../drive/service.js'
import type { AppStreamEntry, AppStreamService } from './service.js'

/** Where the surface lives unless a host mounts it elsewhere. */
export const DEFAULT_APP_PATH = '/app'

/** The words a caller sees when there is nothing at the address it asked for. */
export const NO_SUCH_APP = "There's no App Stream available here."

/** One row of the listing: what the interface needs to draw a tile. */
export interface AppStreamApp {
  id: string
  name: string
  appLoc: string
  /** An asset inside the app, addressed from the app's own URL. */
  logo: string | null
  /** The app's URL, `/app/<id>/`. */
  url: string
  publishedAt: string | null
}

/**
 * What the surface answers, in terms a host can render in its own transport: a
 * `Response` in a worker, `res.status().send()` in express.
 */
export interface AppStreamPage {
  status: number
  body?: string | Uint8Array
  contentType?: string
  headers?: Record<string, string>
  /** Where a `301` sends the caller. */
  location?: string
}

/** The caller's own rule about what it may see; a host supplies it. */
export type AppFilter = (entry: AppStreamEntry) => boolean

export interface AppStreamRequest {
  method: string
  /** The request's path, base path included - `/app/<id>/index.html`. */
  path: string
  allow?: AppFilter
}

export interface AppStreamWebService {
  /** `GET /app/apps.json`. */
  apps(allow?: AppFilter): Promise<{ apps: AppStreamApp[] }>
  /** `GET /app/`. */
  landing(allow?: AppFilter): Promise<AppStreamPage>
  /** Everything else the surface answers, by path and method. */
  request(request: AppStreamRequest): Promise<AppStreamPage>
}

export interface AppStreamWebOptions {
  /** Where the surface is mounted. `/app` by default. */
  basePath?: string
  /** The heading the landing page carries. */
  title?: string
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

/**
 * Text made safe for an attribute or a text node.
 *
 * An app's name and folder are its author's strings, not ours: the previous
 * implementation interpolated them straight into markup, so a folder named
 * `"><script>` was a landing page that ran it.
 */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ESCAPES[character])

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  wasm: 'application/wasm',
  pdf: 'application/pdf',
  zip: 'application/zip'
}

/** The type of a file, by extension; bytes when nothing names it. */
export const contentTypeFor = (filePath: string): string => {
  const extension = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase()

  return CONTENT_TYPES[extension] ?? 'application/octet-stream'
}

/**
 * Caching for an app's own build output.
 *
 * A bundle names its files after their contents (`main.<hash>.js`), so a hashed
 * name is immutable - a deployment ships a new name, never a new body. Everything
 * else, `index.html` above all, has to be revalidated, or a browser keeps opening
 * the previous deployment's shell against the new bundle.
 */
export const cacheControlFor = (filePath: string): string =>
  /\.[0-9a-f]{8,}\.[A-Za-z0-9]+$/.test(filePath)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate'

const html = (status: number, markup: string): AppStreamPage => ({
  status,
  body: markup,
  contentType: 'text/html; charset=utf-8'
})

const json = (status: number, body: unknown): AppStreamPage => ({
  status,
  body: JSON.stringify(body),
  contentType: 'application/json; charset=utf-8'
})

// our own words, not a caller's: no escaping, and a browser shows the same
// sentence the server has always answered with
const noSuchApp = (): AppStreamPage =>
  html(404, `<!doctype html><html><body>${NO_SUCH_APP}</body></html>`)

const methodNotAllowed = (allowed: string): AppStreamPage => ({
  status: 405,
  body: JSON.stringify({ status: 'failure', message: `${allowed} only.` }),
  contentType: 'application/json; charset=utf-8',
  headers: { allow: allowed }
})

/** A path segment as the caller spelled it, or `undefined` when it cannot be read. */
const decoded = (segment: string): string | undefined => {
  try {
    return decodeURIComponent(segment)
  } catch (_) {
    return undefined
  }
}

export const createAppStreamWebService = (
  appStream: AppStreamService,
  drive: DriveService,
  options: AppStreamWebOptions = {}
): AppStreamWebService => {
  const base = (options.basePath ?? DEFAULT_APP_PATH).replace(/\/+$/, '')
  const title = options.title ?? 'SASjs App Stream'

  const urlOf = (entry: AppStreamEntry): string => `${base}/${entry.id}/`

  const rowOf = (entry: AppStreamEntry): AppStreamApp => ({
    id: entry.id,
    name: entry.name,
    appLoc: entry.appLoc,
    logo: entry.logo === undefined ? null : `${urlOf(entry)}${entry.logo}`,
    url: urlOf(entry),
    publishedAt: entry.publishedAt ?? null
  })

  const apps: AppStreamWebService['apps'] = async (allow) => {
    const entries = await appStream.list(allow)

    return { apps: entries.map(rowOf) }
  }

  const landing: AppStreamWebService['landing'] = async (allow) => {
    const { apps: rows } = await apps(allow)

    const tiles = rows.length
      ? `<ul class="apps">${rows
          .map(
            (row) =>
              `<li><a href="${escapeHtml(row.url)}">${escapeHtml(row.name)}</a>` +
              `<span class="loc">${escapeHtml(row.appLoc)}</span></li>`
          )
          .join('')}</ul>`
      : '<p class="empty">No apps have been published yet.</p>'

    return html(
      200,
      [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        `<title>${escapeHtml(title)}</title>`,
        '<style>',
        'body{font-family:system-ui,sans-serif;margin:2rem;color:#1f2430}',
        'h1{font-size:1.4rem}',
        'ul.apps{list-style:none;padding:0;display:grid;gap:.75rem;max-width:40rem}',
        'ul.apps li{display:flex;flex-direction:column;gap:.15rem;padding:.75rem 1rem;',
        'border:1px solid #d8dee9;border-radius:.5rem}',
        'ul.apps a{font-weight:600;text-decoration:none;color:#0b5cad}',
        '.loc{font-size:.8rem;color:#5b6472;font-family:ui-monospace,monospace}',
        '.empty{color:#5b6472}',
        '</style></head><body>',
        `<h1>${escapeHtml(title)}</h1>`,
        tiles,
        '</body></html>'
      ].join('')
    )
  }

  /**
   * The app a URL segment names: its id, or - as a courtesy - its label when one
   * app alone holds that label. An ambiguous label resolves to nothing, because
   * guessing which of two same-named apps a URL meant is worse than a 404.
   */
  const resolve = async (
    segment: string,
    allow?: AppFilter
  ): Promise<AppStreamEntry | undefined> => {
    const entries = await appStream.list(allow)

    const byId = entries.find((entry) => entry.id === segment)

    if (byId) return byId

    const byName = entries.filter((entry) => entry.name === segment)

    return byName.length === 1 ? byName[0] : undefined
  }

  const asset = async (
    entry: AppStreamEntry,
    segments: string[]
  ): Promise<AppStreamPage> => {
    const parts = segments.map(decoded)

    if (parts.some((part) => part === undefined)) return noSuchApp()

    const relative = (parts as string[]).join('/') || 'index.html'

    try {
      const file = await drive.read(
        `${entry.appLoc}/services/${entry.streamWebFolder}/${relative}`
      )

      return {
        status: 200,
        body: file.contents,
        contentType: contentTypeFor(relative),
        headers: { 'cache-control': cacheControlFor(relative) }
      }
    } catch (error) {
      // a missing file, a path that climbs out of the folder and a folder named
      // where a file belongs are one answer to a browser: nothing is here. A
      // fault is not: reporting a drive that went away as a wrong URL would send
      // the caller looking for a typo that is not there.
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.status === 400)
      )
        return noSuchApp()

      throw error
    }
  }

  return {
    apps,
    landing,

    async request({ method, path, allow }) {
      const clean = (path.split(/[?#]/)[0] || '/').replace(/\/{2,}/g, '/')

      const relative =
        base === ''
          ? clean
          : clean === base
            ? '/'
            : clean.startsWith(`${base}/`)
              ? clean.slice(base.length)
              : null

      // a host mounted this at a path it does not own: not an app, not a 404
      // about apps either, so it is the same "nothing here" a wrong name earns
      if (relative === null) return noSuchApp()

      if (relative === '' || relative === '/' || relative === '/index.html') {
        if (method !== 'GET') return methodNotAllowed('GET')

        return landing(allow)
      }

      if (relative === '/apps.json') {
        if (method !== 'GET') return methodNotAllowed('GET')

        return json(200, await apps(allow))
      }

      const segments = relative.split('/').filter(Boolean)
      const key = decoded(segments[0])

      if (key === undefined) return noSuchApp()

      if (method === 'DELETE') {
        const entry = await resolve(key, allow)

        // the id is what a removal names; a label is accepted only because it
        // resolves to exactly one app
        if (!entry) return noSuchApp()

        const removed = await appStream.unpublish(entry.id)

        return json(200, { status: 'success', app: rowOf(removed) })
      }

      if (method !== 'GET') return methodNotAllowed('GET, DELETE')

      const entry = await resolve(key, allow)

      if (!entry) return noSuchApp()

      // `/app/<id>` is a folder, and a folder's files resolve under a trailing
      // slash: a relative URL in the page would otherwise resolve one level up
      if (segments.length === 1 && !relative.endsWith('/'))
        return { status: 301, location: urlOf(entry) }

      return asset(entry, segments.slice(1))
    }
  }
}
