import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

/**
 * `check:routes` compares the route table derived from the vendored document,
 * not the document itself, and the table carries no response headers. A header
 * therefore survives a re-vendor only if the person copying the body notices
 * it - which is how the sign-in lockout lost its `Retry-After`. These assertions
 * name the facts the table cannot carry, so a copy that drops one fails here
 * rather than in a consumer that had come to rely on it.
 */
const text = readFileSync(join(__dirname, 'swagger.yaml'), 'utf8')
const document = parse(text)

describe('the vendored document', () => {
  it('says which revision of sasjs/server it was taken from', () => {
    // the header is the only record of provenance, and a copy that replaces the file
    // wholesale is exactly how it gets lost - which happened once already
    expect(text.split('\n')[0]).toMatch(
      /^# Vendored from sasjs\/server: api\/public\/swagger\.yaml at main \([0-9a-f]{7,},/
    )
  })

  it('states the Retry-After header the sign-in lockout carries', () => {
    const responses = document.paths['/SASLogon/login'].post.responses

    expect(responses['429'].headers['Retry-After']).toEqual({
      description:
        'Whole seconds until the account may attempt a sign-in again',
      schema: { type: 'integer' }
    })
  })

  it('names the unit of that header in the operation description', () => {
    const description = document.paths['/SASLogon/login'].post.description

    // the prose is wrapped for the document, so compare it with the line breaks
    // collapsed rather than pinning where they fall
    expect(description.replace(/\s+/g, ' ')).toContain(
      'carries a `Retry-After` header in seconds'
    )
  })
})
