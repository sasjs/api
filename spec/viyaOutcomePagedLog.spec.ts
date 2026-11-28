import { dispatchViya } from '../src/viya/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import type { Services } from '../src/host/dispatch.js'
import type { ViyaRun } from '../src/viya/seed.js'

const owner = { userId: 'alice', ownerId: 'account-alice', clientId: 'app' }
const foreign = { ...owner, ownerId: 'account-bob' }

test('interleaved warning and error outcomes retain their own paged logs and isolation', async () => {
  const finish = new Map<string, (run: ViyaRun) => void>()
  const services: Services = {
    drive: createDriveService(new MemoryDriveStore()),
    viya: {
      serverUrl: 'http://outcome-pages.invalid',
      execute: ({ name }) =>
        new Promise((resolve) => finish.set(name!, resolve))
    }
  }
  const otherEstate: Services = {
    ...services,
    viya: { ...services.viya!, serverUrl: 'http://other-outcome-pages.invalid' }
  }
  const contexts = await dispatchViya(services, 'GET', '/compute/contexts', {
    subject: owner,
    query: { filter: 'eq(name,"SASjs Mock context")' }
  })
  expect(contexts.status).toBe(200)
  const matching = contexts.body as {
    count: number
    items: Array<{ id: string }>
  }
  expect(matching.count).toBe(1)
  expect(matching.items).toHaveLength(1)
  const missing = await dispatchViya(services, 'GET', '/compute/contexts', {
    subject: owner,
    query: { filter: 'eq(name,"not a mock context")' }
  })
  expect(missing.status).toBe(200)
  expect(missing.body).toMatchObject({ count: 0, items: [] })
  const created = await dispatchViya(
    services,
    'POST',
    `/compute/contexts/${matching.items[0].id}/sessions`,
    { subject: owner }
  )
  expect(created.status).toBe(201)
  const session = (created.body as { id: string }).id
  const paths: Record<string, string> = {}
  for (const name of ['warning', 'error']) {
    const job = await dispatchViya(
      services,
      'POST',
      `/compute/sessions/${session}/jobs`,
      {
        subject: owner,
        body: { name, code: 'synthetic input' }
      }
    )
    expect(job.status).toBe(201)
    paths[name] =
      `/compute/sessions/${session}/jobs/${(job.body as { id: string }).id}`
  }
  const warningLines = Array.from(
    { length: 21007 },
    (_, i) => `warning line ${i}`
  )
  const errorLines = Array.from({ length: 20003 }, (_, i) => `error line ${i}`)
  finish.get('error')!({
    state: 'error',
    jobConditionCode: 12,
    log: errorLines.join('\n')
  })
  finish.get('warning')!({
    state: 'warning',
    jobConditionCode: 4,
    log: warningLines.join('\n')
  })
  await Promise.resolve()
  for (const [name, code, lines] of [
    ['warning', 4, warningLines],
    ['error', 12, errorLines]
  ] as const) {
    const path = paths[name]
    const job = await dispatchViya(services, 'GET', path, { subject: owner })
    expect(job.status).toBe(200)
    expect(job.body).toMatchObject({ state: name, jobConditionCode: code })
    expect(
      (await dispatchViya(services, 'GET', `${path}/state`, { subject: owner }))
        .body
    ).toBe(name)
    const actual: string[] = []
    for (const start of [0, 10000, 20000]) {
      const result = await dispatchViya(services, 'GET', `${path}/log`, {
        subject: owner,
        query: { start: String(start), limit: '10000' }
      })
      expect(result.status).toBe(200)
      const body = result.body as {
        count: number
        items: Array<{ line: string }>
      }
      expect(body.count).toBe(lines.length)
      actual.push(...body.items.map((item) => item.line))
    }
    expect(actual).toEqual(lines)
    for (const suffix of ['', '/state', '/log', '/log/content']) {
      expect(
        (
          await dispatchViya(services, 'GET', path + suffix, {
            subject: foreign
          })
        ).status
      ).toBe(404)
      expect(
        (
          await dispatchViya(otherEstate, 'GET', path + suffix, {
            subject: owner
          })
        ).status
      ).toBe(404)
    }
  }
})
