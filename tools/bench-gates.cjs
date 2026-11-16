/*
 * What the new gates cost per call.
 *
 * Three dispatches over the built package: an ungated route (the baseline), the
 * gated run route as an administrator (one account read), and the same route as
 * the restricted account (one account read, the rules, and a refusal). The store
 * counts its own reads, so the difference is store work rather than wall clock
 * noise.
 */
const API = require('../build/cjs/index.js')

const N = 5000

const counting = (store) => {
  const counts = { userById: 0, permissions: 0, groups: 0 }
  for (const name of Object.keys(counts)) {
    const original = store[name].bind(store)
    store[name] = async (...args) => {
      counts[name] += 1
      return original(...args)
    }
  }
  return counts
}

const bench = async (label, routeId, request) => {
  const store = new API.MemoryIdentityStore()
  const counts = counting(store)
  const services = {
    identity: API.createIdentityService(store),
    records: API.createRecordService(store),
    info: { info: async () => ({ mode: 'browser' }) },
    admin: {
      diagnostics: async () => ({ filesystem: null }),
      logs: async () => [],
      logTail: async () => ({})
    },
    runtime: {
      execute: async () => ({ sessionId: 's', log: '', webout: '', print: '' }),
      trigger: async () => ({})
    },
    drive: API.createDriveService(new API.MemoryDriveStore())
  }

  // one warm-up call, so a cold JIT is not in the number
  await API.dispatch(services, routeId, request).catch(() => undefined)
  for (const key of Object.keys(counts)) counts[key] = 0

  const started = process.hrtime.bigint()
  let status
  for (let i = 0; i < N; i++) {
    const answer = await API.dispatch(services, routeId, request).catch((e) => ({
      status: e.status
    }))
    status = answer.status
  }
  const perCall = Number(process.hrtime.bigint() - started) / N / 1000

  console.log(
    label.padEnd(34),
    'status',
    String(status).padEnd(4),
    perCall.toFixed(1).padStart(6),
    'us/call',
    '| store reads per call: userById',
    (counts.userById / N).toFixed(2),
    'permissions',
    (counts.permissions / N).toFixed(2),
    'groups',
    (counts.groups / N).toFixed(2)
  )
}

const ADMIN = { userId: 'user-admin', clientId: 'web_app' }
const RESTRICTED = { userId: 'user-restricted', clientId: 'web_app' }
const run = { body: { code: 'data _null_; run;', runTime: 'sas' } }

;(async () => {
  console.log(`iterations per case: ${N}`)
  await bench('ungated (GET /info)', 'GET /SASjsApi/info', {})
  await bench('gated run as admin', 'POST /SASjsApi/code/execute', {
    ...run,
    subject: ADMIN
  })
  await bench('gated run as restricted', 'POST /SASjsApi/code/execute', {
    ...run,
    subject: RESTRICTED
  })
  await bench('admin report as admin', 'GET /SASjsApi/admin/logs', {
    subject: ADMIN
  })
})()
