/**
 * Derive the route table from the OpenAPI document sasjs/server publishes.
 *
 * Written as plain node rather than TypeScript so it runs without a build step:
 * `npm run sync:routes` regenerates, `npm run check:routes` is the CI guard and
 * exits non-zero when the committed table and the spec disagree.
 *
 * The table is deliberately only what the spec can state - method, path, the
 * parameters, the request content types and the documented responses. The parts
 * a document cannot carry (the body a refusal sends, which capability a route
 * needs, whether this package implements it) live in the hand-written overlay
 * that `src/routes/index.ts` merges in. That split is the point: the generated
 * half cannot drift from the server's own description, and the hand-written half
 * is small enough to review.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import prettier from 'prettier'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const specPath = join(root, 'spec', 'swagger.yaml')
const outPath = join(root, 'src', 'routes', 'generated.ts')
const METHODS = ['get', 'post', 'put', 'patch', 'delete']

/**
 * A schema as a caller sees it: a `$ref` is followed into components.schemas,
 * and an `allOf` is merged, because tsoa writes a body as a reference to an
 * interface and the fields of that interface are what a host validates.
 */
const dereference = (schema) => {
  if (!schema || typeof schema !== 'object') return {}
  let resolved = schema
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop()
    resolved = (spec.components?.schemas || {})[name] || {}
  }
  if (resolved.allOf) {
    const merged = { properties: {}, required: [] }
    for (const branch of resolved.allOf) {
      const part = dereference(branch)
      Object.assign(merged.properties, part.properties || {})
      merged.required.push(...(part.required || []))
    }
    resolved = merged
  }
  return resolved
}

/** A schema's JSON type, with the `$ref` and `allOf` forms collapsed. */
const typeOf = (schema = {}) => {
  if (schema.type) return schema.type
  if (schema.properties) return 'object'
  if (schema.items) return 'array'
  if (schema.$ref) return schema.$ref.split('/').pop()
  if (schema.allOf || schema.anyOf || schema.oneOf) return 'object'
  return 'string'
}

/** One operation, as the document words it. */
const operationOf = (method, path, op) => {
  const params = []
  for (const param of op.parameters || []) {
    params.push({
      name: param.name,
      in: param.in,
      required: param.required === true,
      type: typeOf(param.schema),
      ...(param.schema && param.schema.enum ? { enum: param.schema.enum } : {})
    })
  }
  // the body's fields are parameters too, as far as a caller is concerned: a
  // host validating a POST /drive/rename needs to know `newPath` is required
  const ref = op.requestBody?.content || {}
  const requestBodies = Object.keys(ref)
  const json = dereference(
    ref['application/json']?.schema ||
      ref['application/x-www-form-urlencoded']?.schema
  )
  const form = dereference(ref['multipart/form-data']?.schema)
  for (const [schema, where] of [
    [json, 'body'],
    [form, 'formData']
  ]) {
    for (const [name, property] of Object.entries(schema.properties || {})) {
      params.push({
        name,
        in: where,
        required: (schema.required || []).includes(name),
        type: typeOf(property)
      })
    }
  }

  return {
    id: `${method.toUpperCase()} ${path}`,
    method: method.toUpperCase(),
    path,
    tag: (op.tags || [])[0] || '',
    summary: (op.summary || '').trim(),
    params,
    requestBodies,
    responses: Object.entries(op.responses || {})
      .map(([status, response]) => ({
        status: Number(status),
        description: String(response.description || '').trim()
      }))
      .sort((a, b) => a.status - b.status)
  }
}

const spec = parse(readFileSync(specPath, 'utf8'))
const routes = []
for (const [path, item] of Object.entries(spec.paths || {})) {
  for (const method of METHODS) {
    if (item[method]) routes.push(operationOf(method, path, item[method]))
  }
}
routes.sort((a, b) =>
  a.path === b.path
    ? a.method.localeCompare(b.method)
    : a.path.localeCompare(b.path)
)

const header = `/**
 * GENERATED - do not edit.
 *
 * Derived from spec/swagger.yaml (sasjs/server's published OpenAPI document) by
 * scripts/sync-routes.mjs. Run \`npm run sync:routes\` after replacing that file;
 * \`npm run check:routes\` fails the build when the two disagree.
 *
 * The overlay in ./overlay.ts adds what a document cannot say: the body each
 * response carries, which capability a route needs, and whether this package
 * implements it.
 */
import type { GeneratedRoute } from '../types.js'

export const GENERATED_ROUTES: GeneratedRoute[] = `

const body = header + JSON.stringify(routes, null, 2) + '\n'
const config = (await prettier.resolveConfig(outPath)) || {}
const formatted = await prettier.format(body, {
  ...config,
  parser: 'typescript'
})

if (process.argv.includes('--check')) {
  const current = (() => {
    try {
      return readFileSync(outPath, 'utf8')
    } catch {
      return ''
    }
  })()
  if (current !== formatted) {
    console.error(
      'src/routes/generated.ts does not match spec/swagger.yaml. Run `npm run sync:routes` and commit the result.'
    )
    process.exit(1)
  }
  console.log(`route table matches the spec (${routes.length} operations)`)
} else {
  writeFileSync(outPath, formatted)
  console.log(`wrote ${routes.length} operations to src/routes/generated.ts`)
}
