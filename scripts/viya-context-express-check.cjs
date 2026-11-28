// Optional cross-repo integration check: SERVER_API_ROOT must point at a local
// sasjs/server api checkout with its dependencies installed. After npm run build:
// SERVER_API_ROOT=/path/to/server/api node --test scripts/viya-context-express-check.cjs
// No live estate.
const assert = require('node:assert/strict')
const test = require('node:test')
const Module = require('node:module')
const { createRequire } = require('node:module')
const { resolve } = require('node:path')

const serverRoot = process.env.SERVER_API_ROOT
if (!serverRoot)
  throw new Error('Set SERVER_API_ROOT to a sasjs/server api checkout')
const root = resolve(serverRoot)
const serverRequire = createRequire(`${root}/package.json`)
process.env.TS_NODE_PROJECT = `${root}/tsconfig.json`
process.env.TS_NODE_TRANSPILE_ONLY = 'true'
serverRequire('ts-node/register')
const candidate = require('../build/cjs/index.js')
const originalLoad = Module._load
Module._load = function (id, ...args) {
  if (id === '@sasjs/api') return candidate
  return originalLoad.call(this, id, ...args)
}
const express = serverRequire('express')
const request = serverRequire('supertest')
const { createViyaRouter } = require(`${root}/src/routes/viya/index.ts`)

test('the server Express mount refuses repeated context queries', async () => {
  const app = express()
  const drive = candidate.createDriveService(new candidate.MemoryDriveStore())
  app.use(createViyaRouter(() => ({ drive })))
  for (const [query, status, message] of [
    ['filter=eq(name&filter=%22SASjs%20Mock%20context%22)', 400, 'filter'],
    ['filter=eq(name,%22SASjs%20Mock%20context%22)', 200, undefined],
    ['start=0&start=', 400, 'pagination'],
    ['limit=10&limit=', 400, 'pagination'],
    ['sortBy=name&sortBy=name', 400, 'sortBy']
  ]) {
    const result = await request(app).get(`/compute/contexts?${query}`)
    assert.equal(result.status, status, query)
    if (message) assert.match(result.body.message, new RegExp(message))
    else assert.equal(result.body.count, 1)
  }
})
