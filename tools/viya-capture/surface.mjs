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

/**
 * The same text with its comments removed.
 *
 * A comment is not code, and a path in one is prose: `@example /Public/x` in a
 * JSDoc block names a folder in a sentence, not a call the client makes. The
 * first version of this extractor read the raw text, so five doc examples and a
 * JSDoc mention of `/SASjsApi/` appeared in the inventory as operations - and a
 * guard that reddens when someone rewords a comment is measuring the wrong
 * thing.
 *
 * The scan tracks quote state so a `//` inside a string - `'https://host/x'` -
 * does not begin a comment, and it knows a regex literal when it sees one, so
 * `/https?:\/\//` is not mistaken for one either. The regex decision is the
 * usual heuristic - the previous character or keyword - so the residual limit is
 * a regex in a position neither predicts; the cost there is a missed literal,
 * not an invented one.
 */
/**
 * The characters after which a `/` opens a regex literal rather than dividing.
 *
 * A regex is the case that made this scanner drop a call: `/https?:\/\//`
 * contains `//`, so a scanner that only knew about quotes and comments read it
 * as a line comment and blanked the rest of the line - path literals included,
 * silently, which in a scope guard is the under-report the guard exists to
 * prevent.
 */
const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'case',
  'in',
  'of',
  'delete',
  'void',
  'new',
  'do',
  'else',
  'yield',
  'await'
])

const REGEX_PRECEDERS = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '^',
  '~',
  '<',
  '>'
])

export const stripComments = (source) => {
  let code = ''
  let index = 0
  /** The last character that was code rather than whitespace or a comment. */
  let previous = ''
  /** The word being built, and the last complete one - `return /x/` is a regex. */
  let word = ''
  let lastWord = ''
  /**
   * Whether the bracket just closed was an `if`/`while`/`for` condition.
   *
   * `if (x) /re/.test(y)` is a regex, and `(a + b) / 2` is a division - the
   * character `)` cannot tell them apart, and treating every `)` as a regex
   * opener turns the `// comment` after a division into code. That direction is
   * the worse one for a guard: it INVENTS a literal, and check:scope then
   * demands a path the client never asks for.
   */
  let parenAllowsRegex = false
  const parens = []

  while (index < source.length) {
    const character = source[index]
    const next = source[index + 1]

    const opensRegex =
      character === '/' &&
      (previous === '' ||
        REGEX_PRECEDERS.has(previous) ||
        REGEX_KEYWORDS.has(word || lastWord) ||
        (previous === ')' && parenAllowsRegex)) &&
      next !== '/' &&
      next !== '*'

    if (opensRegex) {
      code += character
      index += 1

      let inClass = false

      while (index < source.length) {
        const inside = source[index]
        code += inside
        index += 1

        if (inside === '\\') {
          if (index < source.length) {
            code += source[index]
            index += 1
          }
          continue
        }

        if (inside === '[') inClass = true
        else if (inside === ']') inClass = false
        else if (inside === '/' && !inClass) break
      }

      previous = '/'
      continue
    }

    if (character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        code += ' '
        index += 1
      }
      continue
    }

    if (character === '/' && next === '*') {
      code += '  '
      index += 2
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        code += source[index] === '\n' ? '\n' : ' '
        index += 1
      }
      if (index < source.length) {
        code += '  '
        index += 2
      }
      continue
    }

    if (character === "'" || character === '"' || character === '`') {
      const quote = character
      code += character
      index += 1

      while (index < source.length) {
        const inside = source[index]
        code += inside
        index += 1

        if (inside === '\\') {
          if (index < source.length) {
            code += source[index]
            index += 1
          }
          continue
        }

        if (inside === quote) break
      }

      continue
    }

    code += character
    index += 1

    if (!/\s/.test(character)) previous = character

    if (/[A-Za-z0-9_$]/.test(character)) word += character
    else {
      if (word) lastWord = word
      word = ''
    }

    if (character === '(') {
      parens.push(lastWord.toLowerCase())
      parenAllowsRegex = false
    } else if (character === ')')
      parenAllowsRegex = ['if', 'while', 'for'].includes(parens.pop() ?? '')
    else if (!/\s/.test(character)) parenAllowsRegex = false
  }

  return code
}

/** Every quoted or template path literal in one file's code. */
export const literalsIn = (source) => {
  const found = new Set()

  // every quoted string, then decide whether it names a path
  const pattern = /(['"`])([^'"`\n]*)\1/g

  const code = stripComments(source)

  let match
  while ((match = pattern.exec(code))) {
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
