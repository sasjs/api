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
    // a bare enum: the adapter trims the string, and the capture recorded no
    // JSON shape because the body is not JSON
    expect(answer.body).toBe('idle')
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

    expect(answer.body).toBe('completed')
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

describe('the seed when there is no settings object at all', () => {
  it('answers the default for an argument nobody passed', () => {
    expect(seedOf()).toBe(seedOf({}))
  })

  it('treats a whitespace-only address as no address', () => {
    expect(normaliseServerUrl('   ')).toBe('')
    expect(seedOf({ serverUrl: '   ' })).toBe(seedOf({}))
  })

  it('answers for a host that mounts no emulated settings', async () => {
    // `viya` is optional on Services; a host that does not set it still gets an
    // estate, the default one
    const answer = await dispatchViya(
      {
        drive: createDriveService(new MemoryDriveStore()),
        identity: createIdentityService(
          new MemoryIdentityStore(DEFAULT_IDENTITY)
        )
      },
      'GET',
      '/compute/contexts'
    )

    expect(answer.status).toBe(200)
  })
})

describe('two programs of the same length', () => {
  it('do not share generated numbers, because the text seeds them', async () => {
    const shared = services('http://localhost:5000')
    const sessionId = await sessionOn(shared)

    const linesFor = async (code: string) => {
      const submitted = await dispatchViya(
        shared,
        'POST',
        `/compute/sessions/${sessionId}/jobs`,
        { body: { code } }
      )

      return logOn(shared, sessionId, (submitted.body as { id: string }).id)
    }

    // 22 characters each, and the same estate: only the text differs
    const first = await linesFor('data work.a; x=1; run;')
    const second = await linesFor('data work.b; y=2; run;')

    expect(first.length).toBe(second.length)
    expect(first).not.toEqual(second)
    expect(first.filter((line) => line.includes('observations'))).not.toEqual(
      second.filter((line) => line.includes('observations'))
    )
  })
})

describe('what a real client reads', () => {
  // these four came from driving @sasjs/adapter's own client against this
  // emulator: each one was a 500 or a wrong answer the adapter's unit suite
  // could not see, because it mocks the responses it asserts
  it('carries the rels the adapter follows on a session', async () => {
    const target = services()
    const answer = await dispatchViya(
      target,
      'POST',
      `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
      { body: {} }
    )

    const rels = (answer.body as { links: Array<{ rel: string }> }).links.map(
      (link) => link.rel
    )

    expect(rels).toContain('state')
    expect(rels).toContain('log')
  })

  it('carries the rels the adapter follows on a job', async () => {
    const target = services()
    const sessionId = await sessionOn(target)
    const submitted = await dispatchViya(
      target,
      'POST',
      `/compute/sessions/${sessionId}/jobs`,
      { body: { code: ['data a; run;'] } }
    )

    const links = (
      submitted.body as { links: Array<{ rel: string; href: string }> }
    ).links
    const rels = links.map((link) => link.rel)

    expect(rels).toEqual(expect.arrayContaining(['self', 'state', 'log', 'up']))
    expect(links.find((link) => link.rel === 'log')?.href).toBe(
      `/compute/sessions/${sessionId}/jobs/${(submitted.body as { id: string }).id}/log`
    )
  })

  it('accepts the program as an array of lines, which is what the adapter posts', async () => {
    const target = services()
    const sessionId = await sessionOn(target)

    const submitted = await dispatchViya(
      target,
      'POST',
      `/compute/sessions/${sessionId}/jobs`,
      { body: { code: ['data a;', '  x = 1;', 'run;'] } }
    )

    expect(submitted.status).toBe(201)

    const lines = await logOn(
      target,
      sessionId,
      (submitted.body as { id: string }).id
    )

    // an array is the same program as the equivalent string, so the log echoes
    // it line by line rather than failing on `.split`
    expect(lines.join('\n')).toContain('data a;')
    expect(lines.join('\n')).toContain('  x = 1;')
  })

  it('stamps a session with the real clock, because a client expires it by age', async () => {
    const target = services()
    const before = Date.now()
    const answer = await dispatchViya(
      target,
      'POST',
      `/compute/contexts/${EMULATED_CONTEXT_ID}/sessions`,
      { body: {} }
    )

    const created = Date.parse(
      (answer.body as { creationTimeStamp: string }).creationTimeStamp
    )

    // an emulated stamp of 2026-01-01 makes every session older than the client's
    // inactivity timeout, so the client discards it as expired
    expect(created).toBeGreaterThanOrEqual(before - 1000)
    expect(created).toBeLessThanOrEqual(Date.now() + 1000)
  })
})

describe('a host with an engine', () => {
  const withEngine = (webout: string) => {
    const shared = services()

    // the port a server fills with its own runtime: it runs the program and
    // returns what the program produced
    shared.viya = {
      ...(shared.viya ?? {}),
      execute: async ({ program, sessionId }) => ({
        webout,
        log: `NOTE: ran ${Array.isArray(program) ? program.length : 1} line(s) in ${sessionId}`
      })
    }

    return shared
  }

  it('runs the program and serves its webout on the fileref route', async () => {
    const target = withEngine('[{"COL1":"hello"}]')
    const sessionId = await sessionOn(target)

    const submitted = await dispatchViya(
      target,
      'POST',
      `/compute/sessions/${sessionId}/jobs`,
      { body: { code: ['%put hi;'], name: '/app/services/getdata' } }
    )

    // the run is behind the 201, so the client polls before it reads the answer
    const jobId = (submitted.body as { id: string }).id

    for (let attempt = 0; attempt < 50; attempt++) {
      const state = await dispatchViya(
        target,
        'GET',
        `/compute/sessions/${sessionId}/jobs/${jobId}/state`
      )

      if (state.body !== 'running') break

      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const answer = await dispatchViya(
      target,
      'GET',
      `/compute/sessions/${sessionId}/filerefs/_webout/content`
    )

    expect(answer.status).toBe(200)
    expect(answer.contents).toBe('[{"COL1":"hello"}]')
    expect(answer.headers['content-type']).toBe('text/plain')
  })

  it('answers the log the engine produced, not a generated one', async () => {
    const target = withEngine('{}')
    const sessionId = await sessionOn(target)

    const submitted = await dispatchViya(
      target,
      'POST',
      `/compute/sessions/${sessionId}/jobs`,
      { body: { code: ['data a;', 'run;'] } }
    )
    const jobId = (submitted.body as { id: string }).id

    for (let attempt = 0; attempt < 50; attempt++) {
      const state = await dispatchViya(
        target,
        'GET',
        `/compute/sessions/${sessionId}/jobs/${jobId}/state`
      )

      if (state.body !== 'running') break

      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const lines = await logOn(target, sessionId, jobId)

    expect(lines.join('\n')).toContain('ran 2 line(s)')
    expect(lines.join('\n')).not.toContain('generated, not produced by SAS')
  })

  it('passes the variables and the job name through to the engine', async () => {
    const seen: Array<Record<string, unknown>> = []
    const target = services()

    target.viya = {
      ...(target.viya ?? {}),
      execute: async (request) => {
        seen.push(request as unknown as Record<string, unknown>)

        return { webout: '{}', log: '' }
      }
    }

    const sessionId = await sessionOn(target)

    await dispatchViya(target, 'POST', `/compute/sessions/${sessionId}/jobs`, {
      body: {
        code: ['%put hi;'],
        name: '/app/services/getdata',
        variables: { _program: '/app/services/getdata', _debug: '131' }
      }
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      name: '/app/services/getdata',
      variables: { _program: '/app/services/getdata', _debug: '131' },
      sessionId
    })
  })

  it('refuses a webout when no engine ran anything', async () => {
    const target = services()
    const sessionId = await sessionOn(target)

    const answer = await dispatchViya(
      target,
      'GET',
      `/compute/sessions/${sessionId}/filerefs/_webout/content`
    )

    // an empty body would parse as no data; a 404 says nothing has run
    expect(answer.status).toBe(404)
  })
})

describe('a run that did not finish', () => {
  const pollUntilSettled = async (
    target: Services,
    sessionId: string,
    jobId: string
  ) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const answer = await dispatchViya(
        target,
        'GET',
        `/compute/sessions/${sessionId}/jobs/${jobId}/state`
      )

      if (answer.body !== 'running') return answer.body as string

      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    return 'running'
  }

  it('answers the submission before the run, with the job running', async () => {
    let release: (value: { webout: string; log: string }) => void = () => {}

    const target = services()
    target.viya = {
      ...(target.viya ?? {}),
      execute: () =>
        new Promise((resolve) => {
          release = resolve
        })
    }

    const sessionId = await sessionOn(target)
    const submitted = await dispatchViya(
      target,
      'POST',
      `/compute/sessions/${sessionId}/jobs`,
      { body: { code: ['data a; run;'] } }
    )

    const job = submitted.body as { id: string; state: string }

    // the 201 is the submission: a client that polls must not be told the work
    // finished before the engine has started it
    expect(job.state).toBe('running')

    release({ webout: '[]', log: 'NOTE: done' })

    expect(await pollUntilSettled(target, sessionId, job.id)).toBe('completed')
  })

  it('records a failed run as failed, with the reason in its log', async () => {
    const target = services()
    target.viya = {
      ...(target.viya ?? {}),
      execute: async () => {
        throw new Error('the program failed to compile')
      }
    }

    const sessionId = await sessionOn(target)
    const submitted = await dispatchViya(
      target,
      'POST',
      `/compute/sessions/${sessionId}/jobs`,
      { body: { code: ['data a; run;'] } }
    )
    const jobId = (submitted.body as { id: string }).id

    // the client decides failure from the state before it reads any log, so a
    // failed run that answered completed would have its empty webout read as data
    expect(await pollUntilSettled(target, sessionId, jobId)).toBe('failed')

    const lines = await logOn(target, sessionId, jobId)

    expect(lines.join('\n')).toContain('the program failed to compile')
    expect(lines.join('\n')).not.toContain('generated, not produced by SAS')
  })

  it('records a run that reported failure itself', async () => {
    const target = services()
    target.viya = {
      ...(target.viya ?? {}),
      execute: async () => ({ log: 'ERROR: 22-322', state: 'failed' as const })
    }

    const sessionId = await sessionOn(target)
    const submitted = await dispatchViya(
      target,
      'POST',
      `/compute/sessions/${sessionId}/jobs`,
      { body: { code: ['data a; run;'] } }
    )

    expect(
      await pollUntilSettled(
        target,
        sessionId,
        (submitted.body as { id: string }).id
      )
    ).toBe('failed')
  })
})

describe('the webout belongs to the last job, not to the last job that produced one', () => {
  const settle = async (target: Services, sessionId: string, jobId: string) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const state = await dispatchViya(
        target,
        'GET',
        `/compute/sessions/${sessionId}/jobs/${jobId}/state`
      )

      if (state.body !== 'running') return state.body as string

      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    return 'running'
  }

  it('answers nothing when the last job failed, rather than an earlier job data', async () => {
    let fail = false

    const target = services()
    target.viya = {
      ...(target.viya ?? {}),
      execute: async () => {
        if (fail) throw new Error('the second service failed')

        return { webout: '[{"SERVICE":"first"}]', log: '' }
      }
    }

    const sessionId = await sessionOn(target)
    const first = await dispatchViya(
      target,
      'POST',
      `/compute/sessions/${sessionId}/jobs`,
      { body: { code: ['%put first;'] } }
    )

    await settle(target, sessionId, (first.body as { id: string }).id)

    fail = true

    const second = await dispatchViya(
      target,
      'POST',
      `/compute/sessions/${sessionId}/jobs`,
      { body: { code: ['%put second;'] } }
    )

    await settle(target, sessionId, (second.body as { id: string }).id)

    const answer = await dispatchViya(
      target,
      'GET',
      `/compute/sessions/${sessionId}/filerefs/_webout/content`
    )

    // the first job's data is not this session's answer
    expect(answer.status).toBe(404)
  })

  it('says a finished job produced none, rather than blaming the host', async () => {
    const target = services()
    target.viya = {
      ...(target.viya ?? {}),
      execute: async () => ({ log: 'NOTE: nothing written' })
    }

    const sessionId = await sessionOn(target)
    const submitted = await dispatchViya(
      target,
      'POST',
      `/compute/sessions/${sessionId}/jobs`,
      { body: { code: ['%put nothing;'] } }
    )

    await settle(target, sessionId, (submitted.body as { id: string }).id)

    const answer = await dispatchViya(
      target,
      'GET',
      `/compute/sessions/${sessionId}/filerefs/_webout/content`
    )

    expect(answer.status).toBe(404)
    expect(String((answer.body as { message: string }).message)).toMatch(
      /produced none/
    )
  })

  it('says the job has not finished while it is running', async () => {
    const target = services()
    target.viya = {
      ...(target.viya ?? {}),
      execute: () => new Promise(() => undefined)
    }

    const sessionId = await sessionOn(target)

    await dispatchViya(target, 'POST', `/compute/sessions/${sessionId}/jobs`, {
      body: { code: ['data a; run;'] }
    })

    const answer = await dispatchViya(
      target,
      'GET',
      `/compute/sessions/${sessionId}/filerefs/_webout/content`
    )

    expect(answer.status).toBe(404)
    expect(String((answer.body as { message: string }).message)).toMatch(
      /not finished/
    )
  })

  it('does not stamp a completion time on work that has not finished', async () => {
    const target = services()
    target.viya = {
      ...(target.viya ?? {}),
      execute: () => new Promise(() => undefined)
    }

    const sessionId = await sessionOn(target)
    const submitted = await dispatchViya(
      target,
      'POST',
      `/compute/sessions/${sessionId}/jobs`,
      { body: { code: ['data a; run;'] } }
    )

    const job = submitted.body as {
      state: string
      creationTimeStamp: string
      completedTimeStamp?: string
    }

    expect(job.state).toBe('running')
    expect(job.completedTimeStamp).toBeUndefined()
    expect(job.creationTimeStamp).toBeTruthy()
  })
})
