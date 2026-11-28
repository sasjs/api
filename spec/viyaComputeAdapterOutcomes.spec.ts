import { dispatchViya } from '../src/viya/dispatch.js'
import { EMULATED_CONTEXT_ID } from '../src/viya/compute.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import type { Services } from '../src/host/dispatch.js'
import type { ViyaRun } from '../src/viya/seed.js'

// These are installed adapter 6.2.0 implementations, with only transport and
// session discovery substituted. No real SAS or HTTP authentication is exercised.
const {
  executeOnComputeApi
} = require('@sasjs/adapter/api/viya/executeOnComputeApi')
const {
  ComputeJobExecutor
} = require('@sasjs/adapter/job-execution/ComputeJobExecutor')

it.each([
  ['completed', 0],
  ['warning', 4],
  ['error', 12],
  ['failed', 0]
] as const)(
  'actual adapter observes %s with code %i',
  async (state, jobConditionCode) => {
    const run: ViyaRun = {
      state,
      jobConditionCode,
      log: 'trusted host log',
      webout: '{"ok":true}'
    }
    const services: Services = {
      drive: createDriveService(new MemoryDriveStore()),
      viya: {
        serverUrl: `http://adapter-outcomes-${state}.invalid`,
        execute: async () => run
      }
    }
    const created = await dispatchViya(
      services,
      'POST',
      `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`
    )
    expect(created.status).toBe(201)
    const session = { id: (created.body as { id: string }).id }
    const trace: string[] = []
    const requestClient = {
      getBaseUrl: () => 'http://mock.invalid',
      post: async (url: string, body: Record<string, unknown>) => {
        trace.push(`POST ${url}`)
        const response = await dispatchViya(services, 'POST', url, { body })
        if (response.status >= 400) throw new Error(`HTTP ${response.status}`)
        return { result: response.body }
      },
      get: async (url: string) => {
        trace.push(`GET ${url}`)
        const parsed = new URL(url, 'http://mock.invalid')
        const query = Object.fromEntries(parsed.searchParams.entries())
        const response = await dispatchViya(services, 'GET', parsed.pathname, {
          query
        })
        if (response.status >= 400) throw new Error(`HTTP ${response.status}`)
        return { result: response.contents ?? response.body }
      }
    }
    const manager = {
      getSession: async () => session,
      clearSession: async () => undefined
    }
    const execute = (expectWebout: boolean) =>
      executeOnComputeApi(
        requestClient,
        manager,
        '',
        '/test',
        ['run;'],
        'mock',
        undefined,
        null,
        false,
        expectWebout,
        true,
        { maxPollCount: 1, pollInterval: 1 }
      )
    if (state === 'error' || state === 'failed') {
      const client = {
        executeComputeJob: () => execute(true),
        appendRequest: jest.fn()
      }
      const executor = new ComputeJobExecutor('http://mock.invalid', client)
      await expect(
        executor.execute('/test', null, { contextName: 'mock', debug: false })
      ).rejects.toMatchObject({
        error: {
          details: {
            name: 'ComputeJobExecutionError',
            job: { state, jobConditionCode }
          }
        }
      })
      expect(client.appendRequest).toHaveBeenCalledTimes(1)
    } else {
      const result = await execute(false)
      expect(result.job).toMatchObject({ state, jobConditionCode })
    }
    expect(trace.some((url) => url.includes('/state?'))).toBe(true)
    expect(trace.some((url) => /GET .*\/jobs\/[^/?]+$/.test(url))).toBe(true)
  }
)
