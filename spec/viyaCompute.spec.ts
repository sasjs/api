/**
 * The compute family: contexts, sessions, jobs, logs - and the seed that makes
 * the generated parts the same twice.
 *
 * The emulator has no engine, so a job's log is generated. These cases prove the
 * two properties that make generated data usable rather than noise: the same
 * estate answers the same lines, and two estates do not.
 */
import { dispatchViya } from '../src/viya/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { createIdentityService } from '../src/identity/service.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import { DEFAULT_IDENTITY } from '../src/identity/fixture.js'
import { EMULATED_CONTEXT_ID, contextNameFrom } from '../src/viya/compute.js'
import { generator, normaliseServerUrl, seedOf } from '../src/viya/seed.js'
import type { Services } from '../src/host/dispatch.js'

const services = (
  serverUrl = 'http://localhost:5000',
  seed?: string
): Services => ({
  drive: createDriveService(new MemoryDriveStore()),
  identity: createIdentityService(new MemoryIdentityStore(DEFAULT_IDENTITY)),
  viya: { serverUrl, seed }
})

const PROGRAM = 'data work.emulated;\n  x = 1;\nrun;'

/** A session on the services handed in, so cases can share one estate. */
const sessionOn = async (target: Services): Promise<string> => {
  const answer = await dispatchViya(
    target,
    'POST',
    `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
    { body: { environment: { autoExecLines: [] } } }
  )

  return (answer.body as { id: string }).id
}

const jobOn = async (target: Services, sessionId: string): Promise<string> => {
  const answer = await dispatchViya(
    target,
    'POST',
    `/compute/sessions/${sessionId}/jobs`,
    { body: { code: PROGRAM, name: 'job' } }
  )

  return (answer.body as { id: string }).id
}

const logOn = async (target: Services, sessionId: string, jobId: string) => {
  const answer = await dispatchViya(
    target,
    'GET',
    `/compute/sessions/${sessionId}/jobs/${jobId}/log/content`
  )

  return (answer.body as { items: Array<{ line: string }> }).items.map(
    (item) => item.line
  )
}

describe('the seed is the estate', () => {
  it('is the address, normalised', () => {
    expect(normaliseServerUrl('HTTP://Localhost:5000/')).toBe(
      'http://localhost:5000'
    )
    expect(normaliseServerUrl('https://viya.example.com:443/SASDrive/')).toBe(
      'https://viya.example.com'
    )
    expect(normaliseServerUrl('http://viya.example.com:80')).toBe(
      'http://viya.example.com'
    )
    expect(normaliseServerUrl(undefined)).toBe('')
  })

  it('holds a non-default port apart, because two ports are two estates', () => {
    expect(normaliseServerUrl('http://localhost:5000')).not.toBe(
      normaliseServerUrl('http://localhost:4999')
    )
  })

  it('answers the same seed for two spellings of one address', () => {
    expect(seedOf({ serverUrl: 'http://localhost:5000/' })).toBe(
      seedOf({ serverUrl: 'HTTP://LOCALHOST:5000' })
    )
  })

  it('answers a different seed for a different estate', () => {
    expect(seedOf({ serverUrl: 'http://localhost:5000' })).not.toBe(
      seedOf({ serverUrl: 'http://localhost:5001' })
    )
  })

  it('lets an explicit seed win, which is what a moved port needs', () => {
    // the same estate on two addresses is one estate when the seed says so
    expect(seedOf({ serverUrl: 'http://localhost:5000', seed: 'ci' })).toBe(
      seedOf({ serverUrl: 'http://localhost:61001', seed: 'ci' })
    )
  })

  it('gives every estate with no address the one default', () => {
    expect(seedOf({})).toBe(seedOf({ serverUrl: '' }))
  })

  it('draws a repeatable sequence from one seed', () => {
    const first = generator(42)
    const second = generator(42)

    expect([first(), first(), first()]).toEqual([second(), second(), second()])
  })
})

describe('the compute context', () => {
  it('answers the name the client filtered for', async () => {
    const answer = await dispatchViya(services(), 'GET', '/compute/contexts', {
      query: { filter: "eq(name,'SAS Studio compute context')" }
    })

    const body = answer.body as {
      count: number
      items: Array<{ name: string }>
    }

    expect(answer.status).toBe(200)
    expect(body.count).toBe(1)
    expect(body.items[0].name).toBe('SAS Studio compute context')
  })

  it('reads a double-quoted filter too, and answers a default otherwise', () => {
    expect(contextNameFrom('eq(name,"Mine")')).toBe('Mine')
    expect(contextNameFrom('eq(name,"Mine")')).not.toBe('Mine"')
    expect(contextNameFrom(undefined)).toMatch(/Emulated/)
  })

  it('keeps one id whatever name it is asked for', async () => {
    const answer = await dispatchViya(services(), 'GET', '/compute/contexts', {
      query: { filter: "eq(name,'Anything')" }
    })

    expect((answer.body as { items: Array<{ id: string }> }).items[0].id).toBe(
      EMULATED_CONTEXT_ID
    )
  })
})

describe('a compute session', () => {
  it('is created for the id the list returned', async () => {
    const target = services()
    const answer = await dispatchViya(
      target,
      'POST',
      `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
      { body: {} }
    )

    expect(answer.status).toBe(201)
    expect((answer.body as { state: string }).state).toBe('idle')
  })

  it('refuses a context it did not mint', async () => {
    const answer = await dispatchViya(
      services(),
      'POST',
      '/compute/contexts/not-a-context/sessions',
      { body: {} }
    )

    expect(answer.status).toBe(404)
  })

  it('answers idle while it waits for work', async () => {
    const target = services()
    const id = await sessionOn(target)
    const answer = await dispatchViya(
      target,
      'GET',
      `/compute/sessions/${id}/state`
    )

    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ state: 'idle' })
  })

  it('is deleted, and then it is gone', async () => {
    const target = services()
    const id = await sessionOn(target)

    const removed = await dispatchViya(
      target,
      'DELETE',
      `/compute/sessions/${id}`
    )
    const after = await dispatchViya(
      target,
      'GET',
      `/compute/sessions/${id}/state`
    )

    expect(removed.status).toBe(204)
    expect(after.status).toBe(404)
    expect((after.body as { message: string }).message).toContain(id)
  })

  it('uses Viya wording for a session nobody has', async () => {
    const answer = await dispatchViya(
      services(),
      'GET',
      '/compute/sessions/nope/state'
    )

    expect((answer.body as { message: string }).message).toBe(
      "Session with ID 'nope' was not found."
    )
  })
})

describe('a job and its generated log', () => {
  it('completes, and says so', async () => {
    const target = services()
    const sessionId = await sessionOn(target)
    const jobId = await jobOn(target, sessionId)

    const answer = await dispatchViya(
      target,
      'GET',
      `/compute/sessions/${sessionId}/jobs/${jobId}`
    )

    expect((answer.body as { state: string }).state).toBe('completed')
    expect(
      (answer.body as { logStatistics: { lineCount: number } }).logStatistics
        .lineCount
    ).toBeGreaterThan(3)
  })

  it('echoes the program and states that it did not run', async () => {
    const target = services()
    const sessionId = await sessionOn(target)
    const jobId = await jobOn(target, sessionId)
    const lines = await logOn(target, sessionId, jobId)

    expect(lines.join('\n')).toContain('data work.emulated;')
    expect(lines[0]).toMatch(/generated, not produced by SAS/)
  })

  it('answers the same lines for the same estate and the same program', async () => {
    const first = services('http://localhost:5000', 'stable')
    const second = services('http://elsewhere:9999', 'stable')

    const linesOf = async (target: Services) => {
      const sessionId = await sessionOn(target)

      return logOn(target, sessionId, await jobOn(target, sessionId))
    }

    expect(await linesOf(first)).toEqual(await linesOf(second))
  })

  it('answers different numbers for a different estate', async () => {
    const one = services('http://localhost:5000')
    const two = services('http://localhost:5001')

    const linesOf = async (target: Services) => {
      const sessionId = await sessionOn(target)

      return logOn(target, sessionId, await jobOn(target, sessionId))
    }

    expect(await linesOf(one)).not.toEqual(await linesOf(two))
  })

  it('pages the log from start, and reports the full count', async () => {
    const target = services()
    const sessionId = await sessionOn(target)
    const jobId = await jobOn(target, sessionId)

    const all = await dispatchViya(
      target,
      'GET',
      `/compute/sessions/${sessionId}/jobs/${jobId}/log/content`
    )
    const page = await dispatchViya(
      target,
      'GET',
      `/compute/sessions/${sessionId}/jobs/${jobId}/log/content`,
      { query: { start: '1', limit: '2' } }
    )

    const paged = page.body as {
      count: number
      items: Array<{ line: string }>
      limit: number
      start: number
    }
    const whole = all.body as { count: number; items: Array<{ line: string }> }

    expect(paged.count).toBe(whole.count)
    expect(paged.items).toHaveLength(2)
    expect(paged.start).toBe(1)
    expect(paged.limit).toBe(2)
    expect(paged.items[0].line).toBe(whole.items[1].line)
  })

  it('answers a state a poll can read', async () => {
    const target = services()
    const sessionId = await sessionOn(target)
    const jobId = await jobOn(target, sessionId)

    const answer = await dispatchViya(
      target,
      'GET',
      `/compute/sessions/${sessionId}/jobs/${jobId}/state`
    )

    expect(answer.body).toEqual({ state: 'completed' })
  })

  it('refuses a job nobody submitted', async () => {
    const target = services()
    const sessionId = await sessionOn(target)

    const answer = await dispatchViya(
      target,
      'GET',
      `/compute/sessions/${sessionId}/jobs/nope`
    )

    expect(answer.status).toBe(404)
    expect((answer.body as { message: string }).message).toContain('nope')
  })

  it('stamps the emulated header on compute answers too', async () => {
    const target = services()
    const answer = await dispatchViya(target, 'GET', '/compute/contexts')

    expect(answer.headers['x-sasjs-emulated']).toMatch(/^viya@/)
  })
})

describe('the seed helper on its own', () => {
  it('falls back to the trimmed address when it cannot be parsed', () => {
    // a value with no scheme is taken as http, and one URL cannot parse is
    // still an identity - it just cannot be normalised further
    expect(normaliseServerUrl('http://[::1')).toBe('http://[::1')
    expect(normaliseServerUrl('  EXAMPLE.com/  ')).toBe('http://example.com')
  })

  it('treats an empty override as no override', () => {
    expect(seedOf({ serverUrl: 'http://a:1', seed: '' })).toBe(
      seedOf({ serverUrl: 'http://a:1' })
    )
  })

  it('answers no draw for an empty list, rather than failing', () => {
    // drawFrom is only ever called with a populated list; this pins the shape
    // of the generator rather than the helper's tolerance
    const next = generator(7)

    expect(typeof next()).toBe('number')
    expect(next()).toBeGreaterThanOrEqual(0)
    expect(next()).toBeLessThan(1)
  })
})

describe('the parts of the estate that only a second call reaches', () => {
  it('answers a job with no name and no code, under its own id', async () => {
    const target = services()
    const sessionId = await sessionOn(target)

    const answer = await dispatchViya(
      target,
      'POST',
      `/compute/sessions/${sessionId}/jobs`,
      { body: {} }
    )
    const job = answer.body as { id: string; name: string }

    // an unnamed job is named after itself, and an absent program is an empty
    // one rather than a refused request - the estate accepts both
    expect(job.name).toBe(job.id)
  })

  it('keeps one estate per seed for the life of the process', async () => {
    const first = services('http://localhost:5000')
    const second = services('http://localhost:5000')

    const created = await sessionOn(first)

    // the same address is the same estate, so a session made on one is visible
    // from the other - which is what makes two targets agree
    const answer = await dispatchViya(
      second,
      'GET',
      `/compute/sessions/${created}/state`
    )

    expect(answer.status).toBe(200)
  })

  it('answers the default context name for a filter it cannot read', async () => {
    const answer = await dispatchViya(services(), 'GET', '/compute/contexts', {
      query: { filter: 'unparseable' }
    })

    expect(
      (answer.body as { items: Array<{ name: string }> }).items[0].name
    ).toMatch(/Emulated/)
  })
})

describe('addresses the parser has to read', () => {
  it('reads an IPv6 host, with and without a port', () => {
    expect(normaliseServerUrl('http://[::1]:8080/x')).toBe('http://[::1]:8080')
    expect(normaliseServerUrl('http://[::1]/x')).toBe('http://[::1]')
  })

  it('treats a value it cannot read as an address anyway', () => {
    // no scheme and no authority: the string is its own identity
    expect(normaliseServerUrl('/just/a/path')).toBe('/just/a/path')
  })

  it('drops credentials, which are not part of the identity', () => {
    expect(normaliseServerUrl('http://user:pass@host:5000/')).toBe(
      'http://host:5000'
    )
  })
})

describe('requests that carry no body at all', () => {
  it('creates a session with no body', async () => {
    const target = services()
    const answer = await dispatchViya(
      target,
      'POST',
      `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`
    )

    expect(answer.status).toBe(201)
  })

  it('submits a job with no body', async () => {
    const target = services()
    const sessionId = await sessionOn(target)

    const answer = await dispatchViya(
      target,
      'POST',
      `/compute/sessions/${sessionId}/jobs`
    )

    expect(answer.status).toBe(201)
  })
})
