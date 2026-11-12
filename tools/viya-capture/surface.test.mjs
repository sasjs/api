import test from 'node:test'
import assert from 'node:assert/strict'
import { literalsIn, normalise } from './surface.mjs'

test('a query and a client-side marker are not part of the path', () => {
  assert.equal(
    normalise('/folders/folders/@item?path=/Public/x'),
    '/folders/folders/@item'
  )
  assert.equal(normalise('/types/types?limit=999999'), '/types/types')
  assert.equal(normalise('/files/files#rawUpload'), '/files/files')
})

test('a placeholder becomes one segment, however it was written', () => {
  assert.equal(
    normalise('/compute/sessions/${id}/jobs'),
    '/compute/sessions/{}/jobs'
  )
  assert.equal(
    normalise('/compute/sessions/${a}/${b}/jobs'),
    '/compute/sessions/{}/{}/jobs',
    'two parameters stay two segments: merging them would hide a route difference'
  )
})

test('a literal ending at a separator is a prefix the caller appends to', () => {
  assert.equal(normalise('/folders/folders/'), '/folders/folders/{}')
})

test('a template whose path follows the server URL is still a call', () => {
  // this is the shape an extractor that demanded a leading slash missed:
  // `${this.serverUrl}/identities/users/@currentUser`
  const literals = literalsIn(
    'const url = `${this.serverUrl}/identities/users/@currentUser`'
  )

  assert.deepEqual(literals, ['/identities/users/@currentUser'])
})

test('a URL with a scheme is not a path, and neither is prose', () => {
  const literals = literalsIn(
    [
      'const host = "https://estate.example.com/thing"',
      'const note = "a slash / inside a sentence"',
      'const relative = "not/a/path"'
    ].join('\n')
  )

  assert.deepEqual(literals, [])
})

test('single quotes, double quotes and backticks are all read', () => {
  const literals = literalsIn(
    [
      "requestClient.get('/folders/folders/@myRecycleBin')",
      'requestClient.post("/files/files", body)',
      'requestClient.put(`${fileUri}/content`, text)'
    ].join('\n')
  )

  assert.deepEqual(literals.sort(), [
    '/content',
    '/files/files',
    '/folders/folders/@myRecycleBin'
  ])
})

test('a path in a doc comment is prose, not a call', () => {
  // the first extractor read the raw text, so five JSDoc examples and a
  // sentence about `/SASjsApi/` arrived in the inventory as operations
  const literals = literalsIn(
    [
      '/**',
      ' * @param folderPath - the full path (eg `/Public/example/deleteThis`) to remove.',
      ' * `SASjsApi`, `/SASjsApi/` and ` /SASjsApi ` all mean the same mount.',
      ' */',
      "requestClient.get('/folders/folders/@item')"
    ].join('\n')
  )

  assert.deepEqual(literals, ['/folders/folders/@item'])
})

test('a comment does not begin inside a string', () => {
  const literals = literalsIn(
    [
      "const base = 'https://host/x' // not a comment start inside the string",
      "const path = '/files/files'"
    ].join('\n')
  )

  // the URL is not a path and is dropped on its own merits; what this pins is
  // that the `//` inside it did not swallow the line after it
  assert.deepEqual(literals, ['/files/files'])
})

test('a block comment ends where it says, and code after it still counts', () => {
  const literals = literalsIn(
    '/* /not/this */ const a = "/types/types"; /* and /nor/this */'
  )

  assert.deepEqual(literals, ['/types/types'])
})

test('an escaped-slash regex does not blank the rest of the line', () => {
  // `/https?:\/\//` contains `//`; a scanner that reads it as a line comment
  // loses every path after it on that line, silently - the under-report a scope
  // guard exists to prevent
  const literals = literalsIn(
    "const b = u.replace(/https?:\\/\\//g, ''); const p = '/files/files'"
  )

  assert.deepEqual(literals, ['/files/files'])
})

test('a division is not a regex, and a regex in a class keeps its slashes', () => {
  const literals = literalsIn(
    [
      "const ratio = total / count; const p = '/types/types'",
      "const split = value.replace(/[/]/g, '-'); const q = '/folders/folders'"
    ].join('\n')
  )

  assert.deepEqual(literals.sort(), ['/folders/folders', '/types/types'])
})
