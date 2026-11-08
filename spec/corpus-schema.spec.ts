import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

import { CODE_CORPUS } from '../src/corpus/code.js'
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

// resolved from this file rather than the process CWD: jest's `roots` governs
// discovery, not where a `readFileSync` lands, and a wrong CWD would take the
// whole suite down at module load rather than failing one test
const document = parse(
  readFileSync(join(__dirname, 'swagger.yaml'), 'utf8')
) as any
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
export const differences = (
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
        found.push(`${at ? `${at}.${key}` : key} is pinned but not documented`)
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
    // A string body travels either as a JSON string (`Promise<string>` in tsoa,
    // `res.json` in the server) or as raw text from a route that sends it
    // itself, and the two are not interchangeable: a host that sends the raw
    // text where the document says JSON is a divergence. So the encoding is
    // decided per case - stated, or read from what the document declares.
    const declared = json?.schema ? resolve(json.schema) : undefined
    const encoding = testCase.expect.encoding || (json ? 'json' : 'text')

    if (encoding === 'json')
      return json && declared?.type === 'string'
        ? []
        : [
            'the corpus pins a JSON string and the document does not declare one'
          ]

    return json
      ? ['the corpus pins a text body and the document declares JSON']
      : []
  }

  if (!json?.schema)
    return ['the corpus pins a body and the document declares no schema']

  return [...new Set(differences(wanted, json.schema, ''))]
}

describe('every body the corpus pins is the body the document declares', () => {
  const cases = [
    ...DRIVE_CORPUS,
    ...CODE_CORPUS,
    ...IDENTITY_CORPUS,
    ...RECORD_CORPUS
  ]

  it.each(cases.filter((testCase) => testCase.expect.body !== undefined))(
    '$id',
    (testCase) => {
      expect(mismatches(testCase)).toEqual([])
    }
  )
})

/**
 * The gate's own failure, pinned. Every assertion below currently passes, so a
 * change that made `differences` return nothing - or `resolve` stop following a
 * `$ref` - would leave the suite green and the drift it exists to catch
 * unguarded. These are the exact strings it reports for the two shapes that
 * matter: a principal that became an identifier, and a field nobody documented.
 */
describe('the schema comparison itself', () => {
  const schemaOf = {
    PermissionDetailsResponse: {
      type: 'object',
      properties: {
        uid: { type: 'string' },
        user: { $ref: '#/components/schemas/UserResponse' }
      }
    },
    UserResponse: {
      type: 'object',
      properties: { uid: { type: 'string' }, username: { type: 'string' } }
    }
  }

  // `resolve` reads the module-level `schemas` table, which is built from the
  // vendored document; the fixture names are the ones it already holds
  it('reports an identifier where the schema documents an account', () => {
    expect(
      differences(
        { uid: 'rule-1', user: 'user-restricted' },
        schemaOf.PermissionDetailsResponse,
        ''
      )
    ).toContain('user is documented as object, the corpus pins string')
  })

  it('follows a $ref rather than treating it as unconstrained', () => {
    // a populated account is what the schema declares, so it compares clean -
    // which is only true if the ref was resolved
    expect(
      differences(
        {
          uid: 'rule-1',
          user: { uid: 'user-restricted', username: 'sasjsuser' }
        },
        schemaOf.PermissionDetailsResponse,
        ''
      )
    ).toEqual([])
  })

  it('reports a field the document does not declare', () => {
    expect(
      differences(
        { uid: 'rule-1', hidden: true },
        schemaOf.PermissionDetailsResponse,
        ''
      )
    ).toEqual(['hidden is pinned but not documented'])
  })

  it('compares the elements of an array, not only the array', () => {
    expect(
      differences(
        [{ uid: 'rule-1', user: 'user-restricted' }],
        { type: 'array', items: schemaOf.PermissionDetailsResponse },
        ''
      )
    ).toContain('user is documented as object, the corpus pins string')
  })

  it('reports a body pinned against a response with no schema', () => {
    // the delete routes answer text, so this is the branch that keeps the gate
    // from demanding a schema where the document carries the message instead
    const response = document.paths['/SASjsApi/permission/{uid}'].delete
    expect(response.responses['200'].content).toBeUndefined()
  })
})
