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

export const isPathLike = (literal) =>
  literal.startsWith('/') &&
  // two slashes open a comment (and would open a protocol-relative URL, which is
  // not a route either). Without this, the text of a `//` comment in a build -
  // the CLI generates several - is read as a path, lands in the inventory as an
  // English sentence, and makes the guard redden when a comment is reworded
  !literal.startsWith('//') &&
  literal.length > 1 &&
  /[A-Za-z]/.test(literal) &&
  // a route carries no newline or tab, and no length a URL could not have: the
  // CLI's build embeds SAS programs and documentation, so a template literal that
  // begins with `/` and runs for a page is prose, not a call. Spaces stay allowed
  // - `/User Folders/{}/My Folder/sasjs/runner` is a real SAS 9 path
  !/[\r\n\t]/.test(literal) &&
  literal.length <= 200 &&
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

const filesUnder = (directory, skip = SKIP) =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)

    if (statSync(path).isDirectory())
      // `dist/` and `minified/` are bundles OF the same sources, and
      // `node_modules/` is the adapter's own dependencies - a path literal
      // inside a url-parsing library is not a call the adapter makes
      return skip.has(entry) ? [] : filesUnder(path, skip)

    return path.endsWith('.js') ? [path] : []
  })

/**
 * The inventory: every distinct normalised path, with the files that name it,
 * so a reader can go and look.
 *
 * `skip` adds directories to the ones above. It exists for the CLI, whose build
 * carries a vendored web bundle under `assets/`: that bundle is a browser app's
 * own URLs, not a call the CLI makes, and read as an inventory it turns four
 * literals into several hundred - a guard that reddens when a demo page changes
 * a link would be measuring the wrong client.
 */
export const extract = (adapterDir, { skip = [] } = {}) => {
  const byPath = new Map()

  for (const file of filesUnder(adapterDir, new Set([...SKIP, ...skip]))) {
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

/**
 * The route prefixes the emulator is built for, and nothing outside them.
 *
 * The same list the families in `src/viya/surface.ts` belong to. It is here
 * rather than there because this file is the instrument, and the instrument must
 * be able to say what it kept.
 */
export const VIYA_PREFIXES = [
  '/SASLogon',
  '/folders',
  '/files',
  '/compute',
  '/jobExecution',
  '/jobDefinitions',
  '/identities',
  '/types',
  '/launcher'
]

const isViyaPath = (path) =>
  VIYA_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix + '/')
  )

/**
 * The same inventory, restricted to the Viya prefixes the emulator answers.
 *
 * The adapter needs no such filter: it is an HTTP client and nearly every path
 * literal in it is a call. The CLI is not - its build embeds SAS fixtures, its
 * own documentation examples, the mock site's sources and its own test files, so
 * an unfiltered read of it returns several hundred literals of which a handful
 * are calls. The tests matter as much as the rest: a fixture added to a spec file
 * is a fixture, not a call, and reading it as one would make a CLI test change
 * demand a classification in `src/viya/surface.ts`. Filtering by prefix is what
 * makes the two inventories comparable; `dropped` is reported so a reader can see
 * how much was set aside, and a change in that count is a change worth looking at.
 */
export const extractViya = (directory, options) => {
  const all = extract(directory, options)
  const kept = {}
  const dropped = []

  for (const [path, files] of Object.entries(all)) {
    if (isViyaPath(path)) kept[path] = files
    else dropped.push(path)
  }

  return { kept, dropped: dropped.sort() }
}
