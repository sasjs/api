import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

import { DRIVE_CORPUS } from '../src/corpus/drive.js'
import type { CorpusCase } from '../src/corpus/drive.js'
import { IDENTITY_CORPUS } from '../src/corpus/identity.js'
import { RECORD_CORPUS } from '../src/corpus/records.js'

/**
 * The corpus says what a host is shown to answer; the document says what a host
 * may answer. `corpus-parity.spec.ts` compares their statuses, and comparing
 * statuses alone let a real drift through: sasjs/api#27 changed a rule's
 * principal from an account to an identifier, every case was updated with it,
 * and the vendored schema went on describing `$ref UserResponse` because nothing
 * read the body.
 *
 * This reads the body. For every case that pins one, the documented response
 * must declare a schema at all, and every field the case pins must have the type
 * the schema declares - resolving `$ref`, one array level, and one object level
 * at a time.
 */

const document = parse(readFileSync('spec/swagger.yaml', 'utf8')) as any
const schemas: Record<string, any> = document?.components?.schemas || {}

/** Follow a `$ref` to the schema it names, and no further than it must. */
const resolve = (schema: any, seen: Set<string> = new Set()): any => {
  let current = schema
  while (current?.$ref) {
    const name = String(current.$ref).split('/').pop() as string
    if (seen.has(name)) return current
    seen.add(name)
    current = schemas[name]
  }
  return current
}

/** What a value is, in the vocabulary a schema uses. */
const typeOf = (value: unknown): string => {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value === 'object' ? 'object' : typeof value
}

const operationOf = (route: string): any => {
  const [method, path] = route.split(' ')
  return document?.paths?.[path]?.[method.toLowerCase()]
}

/** Every place where a pinned value and the documented type disagree. */
const differences = (
  value: unknown,
  schema: any,
  at: string,
  found: string[] = []
): string[] => {
  const declared = resolve(schema)
  if (!declared || value === undefined) return found

  const expected = declared.type
  const actual = typeOf(value)

  if (expected && actual !== expected) {
    found.push(
      `${at || 'the body'} is documented as ${expected}, the corpus pins ${actual}`
    )
    return found
  }

  // an array's elements are read at the same path: the case names the field,
  // and "[]" in front of it says nothing a reader needs
  if (actual === 'array' && declared.items)
    for (const element of value as unknown[])
      differences(element, declared.items, at, found)

  if (actual === 'object') {
    const properties = declared.properties || {}
    for (const [key, inner] of Object.entries(
      value as Record<string, unknown>
    )) {
      const property = properties[key]
      if (!property) {
        found.push(`${at || 'the body'}.${key} is pinned but not documented`)
        continue
      }
      differences(inner, property, at ? `${at}.${key}` : key, found)
    }
  }

  return found
}

/** A case pins a body; the response must be able to carry one. */
const mismatches = (testCase: CorpusCase): string[] => {
  const wanted = testCase.expect.body
  if (wanted === undefined) return []

  const response = operationOf(testCase.route)?.responses?.[
    String(testCase.expect.status)
  ]
  if (!response)
    return [`${testCase.route} documents no ${testCase.expect.status}`]

  const content = response.content || {}
  const json = content['application/json']

  // A message a host sends as its body is text; the document carries it in the
  // description, which is what tsoa emits for a string return.
  if (typeof wanted === 'string') {
    return json
      ? ['the corpus pins a text body and the document declares JSON']
      : []
  }

  if (!json?.schema)
    return ['the corpus pins a body and the document declares no schema']

  return [...new Set(differences(wanted, json.schema, ''))]
}

describe('every body the corpus pins is the body the document declares', () => {
  const cases = [...DRIVE_CORPUS, ...IDENTITY_CORPUS, ...RECORD_CORPUS]

  it.each(cases.filter((testCase) => testCase.expect.body !== undefined))(
    '$id',
    (testCase) => {
      expect(mismatches(testCase)).toEqual([])
    }
  )
})
