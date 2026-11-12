/**
 * What the adapter actually asks for, extracted from the adapter itself.
 *
 * The emulator's scope is the client's call surface, so the client is what has
 * to be measured. Reading a table and hoping it matches is not a guard; this
 * walks the installed `@sasjs/adapter` build and lists every path literal it can
 * find, normalised to a template (`/folders/folders/{}`).
 *
 * Two things it deliberately does NOT do:
 *
 * - it does not decide a verb. The verb lives at the call site, not in the
 *   string, and guessing one from a path would be the sort of quiet invention
 *   that makes a guard lie. `src/viya/surface.ts` states the verb, and the
 *   comparison is on paths.
 * - it does not drop what looks like a different server type. `/SASStoredProcess`
 *   and `/SASjsApi` belong to the SAS 9 and SASjs surfaces, and the declaration
 *   is where they are declined with a reason - not in the extractor, where the
 *   exclusion would be invisible to a reviewer.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const isPathLike = (literal) =>
  literal.startsWith('/') &&
  literal.length > 1 &&
  /[A-Za-z]/.test(literal) &&
  // a regex fragment or a lone slash is not a route
  !/^\/[a-z]?$/i.test(literal)

/**
 * Turns a literal into the shape a route table can compare.
 *
 * A template placeholder becomes `{}`, and a literal that ends at a separator is
 * a prefix the caller appends to - `/files/files/` + an id is one operation, not
 * a path called `/files/files/`. The query is kept out of the path because a
 * route table matches paths; `#rawUpload` is a client-side marker the adapter
 * appends to a URL and never reaches the server as a segment.
 */
export const normalise = (literal) => {
  const withoutClientMarker = literal.split('#')[0]
  const withoutQuery = withoutClientMarker.split('?')[0]

  const withPlaceholders = withoutQuery.replace(/\$\{[^}]*\}/g, '{}')

  // collapse runs of placeholders, and a trailing separator means "a prefix"
  const collapsed = withPlaceholders.replace(/(\{\})+/, '{}')
  const trimmed = collapsed.endsWith('/') ? collapsed + '{}' : collapsed

  return trimmed.replace(/\/{2,}/g, '/').replace(/\/$/, '')
}

/** Every quoted or template path literal in one file's text. */
export const literalsIn = (source) => {
  const found = new Set()

  // every quoted string, then decide whether it names a path
  const pattern = /(['"`])([^'"`\n]*)\1/g

  let match
  while ((match = pattern.exec(source))) {
    // a template placeholder becomes `{}` here so the path after it survives;
    // `${this.serverUrl}/identities/users/@currentUser` is a request, and a
    // matcher that demanded a leading slash missed it
    const expanded = match[2].replace(/\$\{[^}]*\}/g, '{}')

    // the server URL is a variable at the front of the template: drop it
    const withoutOrigin = expanded.startsWith('{}')
      ? expanded.slice(2)
      : expanded

    if (withoutOrigin.startsWith('/')) found.add(withoutOrigin)
  }

  return [...found]
}

const SKIP = new Set(['node_modules', 'dist', 'minified', 'docs', 'vendor'])

const filesUnder = (directory) =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)

    if (statSync(path).isDirectory())
      // `dist/` and `minified/` are bundles OF the same sources, and
      // `node_modules/` is the adapter's own dependencies - a path literal
      // inside a url-parsing library is not a call the adapter makes
      return SKIP.has(entry) ? [] : filesUnder(path)

    return path.endsWith('.js') ? [path] : []
  })

/**
 * The inventory: every distinct normalised path, with the files that name it,
 * so a reader can go and look.
 */
export const extract = (adapterDir) => {
  const byPath = new Map()

  for (const file of filesUnder(adapterDir)) {
    const where = relative(adapterDir, file)

    for (const literal of literalsIn(readFileSync(file, 'utf8'))) {
      if (!isPathLike(literal)) continue

      const path = normalise(literal)

      if (!path || path === '/' || path.startsWith('//')) continue

      if (!byPath.has(path)) byPath.set(path, new Set())

      byPath.get(path).add(where)
    }
  }

  return Object.fromEntries(
    [...byPath.keys()]
      .sort()
      .map((path) => [path, [...byPath.get(path)].sort()])
  )
}
