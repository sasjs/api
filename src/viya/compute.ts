/**
 * The compute family: contexts, sessions, jobs and the logs generated for them.
 *
 * These are the operations a `serverType=SASVIYA` application needs before it can
 * do anything: find a context, start a session, submit a program, poll it, read
 * its log. The emulator answers all of them from `EmulatedEstate` - this process -
 * because there is no SAS engine to reach for in a browser and no reason to reach
 * for one here.
 *
 * The context is the one place the emulator answers the question it was asked
 * rather than one it chose: a client names the context it wants by filter and the
 * emulated estate has exactly one, under that name. Its id does not move with the
 * name, so a session can be created for the id the list returned.
 */
import type { ApiResponse, Services } from '../host/dispatch.js'
import { ApiError } from '../types.js'
import { normaliseServerUrl } from './seed.js'
import { seedOf } from './seed.js'
import { estateFor, type EmulatedJob } from './sessions.js'
import { EMULATED_USER, idFor } from './ids.js'

/** The name the emulator answers when a client asks for no particular context. */
export const DEFAULT_CONTEXT_NAME = 'Emulated Compute Context'

/** The one context id this estate mints, whatever name it is asked for. */
export const EMULATED_CONTEXT_ID = idFor('emulated-context', 'context')

/**
 * The links a client follows, by rel.
 *
 * The rels are not decoration: the adapter reads `state` to poll a session and a
 * job, `log` to fetch the log, `up` to reach the session from a job. A body that
 * carried only `self` answered 201 and then failed the client, which is how the
 * conformance harness found this.
 */
const relLinks = (type: string, rels: Array<[rel: string, href: string]>) =>
  rels.map(([rel, href]) => ({ href, uri: href, rel, method: 'GET', type }))

const linksFor = (
  uri: string,
  type: string,
  collection = false,
  itemType = false
) => [
  // the collection link comes first, because that is the order the capture
  // recorded and the item shape assertion walks the first element
  ...(collection
    ? [
        {
          href: `${uri}/members`,
          uri: `${uri}/members`,
          rel: 'members',
          method: 'GET',
          type,
          itemType: type
        }
      ]
    : []),
  {
    href: uri,
    uri,
    rel: 'self',
    method: 'GET',
    type,
    // the log's capture records itemType on its first link, so it is stamped
    // there rather than invented as a members link the estate does not have
    ...(itemType ? { itemType: type } : {})
  }
]

const estateOf = (services: Services) => estateFor(seedOf(services.viya))

/**
 * The context name a client asked for.
 *
 * The adapter filters by name (`filter=eq(name,'X')`), so the answer is the one
 * emulated context under the requested name. A second estate is not something an
 * emulator can have, and an empty list would fail a client that has nothing wrong
 * with it.
 */
export const contextNameFrom = (filter: string | undefined): string => {
  if (!filter) return DEFAULT_CONTEXT_NAME

  const match = /name\s*,\s*'([^']*)'|name\s*,\s*"([^"]*)"/i.exec(filter)

  return match?.[1] ?? match?.[2] ?? DEFAULT_CONTEXT_NAME
}

const contextBody = (name: string) => ({
  id: EMULATED_CONTEXT_ID,
  name,
  createdBy: EMULATED_USER.id,
  version: 2,
  links: linksFor(
    `/compute/contexts/${EMULATED_CONTEXT_ID}`,
    'application/vnd.sas.compute.context'
  )
})

const sessionBody = (
  services: Services,
  session: { id: string; createdAt: string },
  autoExecLines: string[]
) => {
  const { id } = session
  const uri = `/compute/sessions/${id}`

  return {
    id,
    applicationName: 'emulated',
    owner: EMULATED_USER.id,
    serverId: idFor(
      normaliseServerUrl(services.viya?.serverUrl) || 'emulated',
      'server'
    ),
    state: 'idle',
    attributes: {
      homeDirectory: '/tmp/emulated',
      sessionInactiveTimeout: 3600
    },
    environment: { autoExecLines },
    // the real clock: the adapter computes a session's age from this stamp and
    // expires it against sessionInactiveTimeout
    creationTimeStamp: session.createdAt,
    serviceAPIVersion: 1,
    sessionConditionCode: 0,
    stateElapsedTime: 0,
    version: 2,
    links: relLinks('application/vnd.sas.compute.session', [
      ['self', uri],
      ['state', `${uri}/state`],
      ['log', `${uri}/log`],
      ['jobs', `${uri}/jobs`]
    ])
  }
}

const jobBody = (job: EmulatedJob) => {
  const uri = `/compute/sessions/${job.sessionId}/jobs/${job.id}`

  return {
    id: job.id,
    name: job.name,
    sessionId: job.sessionId,
    state: job.state,
    creationTimeStamp: job.creationTimeStamp,
    completedTimeStamp: job.completedTimeStamp,
    jobConditionCode: 0,
    stateElapsedTime: 1,
    listingStatistics: {
      lineCount: job.log.length,
      modifiedTimeStamp: job.completedTimeStamp
    },
    logStatistics: {
      lineCount: job.log.length,
      modifiedTimeStamp: job.completedTimeStamp
    },
    statistics: { systemCpuTime: 0.01, userCpuTime: 0.02 },
    version: 2,
    links: relLinks('application/vnd.sas.compute.job', [
      ['self', uri],
      ['state', `${uri}/state`],
      ['log', `${uri}/log`],
      ['up', `/compute/sessions/${job.sessionId}`]
    ])
  }
}

/** The session the request names, or the 404 a client that lost it expects. */
const sessionOf = (services: Services, id: string) => {
  const session = estateOf(services).session(id)

  if (!session)
    throw new ApiError(404, `Session with ID '${id}' was not found.`)

  return session
}

const jobOf = (services: Services, sessionId: string, jobId: string) => {
  const job = sessionOf(services, sessionId).jobs.get(jobId)

  if (!job) throw new ApiError(404, `Job with ID '${jobId}' was not found.`)

  return job
}

/**
 * The `{}` values a request carried, in path order.
 *
 * `dispatchViya` sets `segments` on every request it hands a handler, so there is
 * no absent case to answer - a fallback here would be a branch nothing reaches.
 */
const segmentsOf = (params: Record<string, string>): string[] =>
  (params as unknown as { segments: string[] }).segments

export const COMPUTE_HANDLERS: Record<
  string,
  (context: {
    services: Services
    request: {
      query?: Record<string, string | undefined>
      body?: unknown
      token?: string
      subject?: unknown
    }
    params: Record<string, string>
  }) => Promise<ApiResponse>
> = {
  'GET /compute/contexts': async ({ request }) => {
    const limit = Number(request.query?.limit ?? 0) || 0

    return {
      status: 200,
      body: {
        accept: 'application/json',
        name: 'contexts',
        start: 0,
        limit,
        count: 1,
        version: 2,
        items: [contextBody(contextNameFrom(request.query?.filter))],
        links: linksFor(
          '/compute/contexts',
          'application/vnd.sas.compute.context',
          true
        )
      }
    }
  },

  'POST /compute/contexts/{}/sessions': async ({
    services,
    params,
    request
  }) => {
    if (params.id !== EMULATED_CONTEXT_ID)
      throw new ApiError(404, `Context with ID '${params.id}' was not found.`)

    const body = (request.body ?? {}) as {
      environment?: { autoExecLines?: string[] }
    }

    const session = estateOf(services).create()

    return {
      status: 201,
      body: sessionBody(
        services,
        session,
        body.environment?.autoExecLines ?? []
      )
    }
  },

  'GET /compute/sessions/{}/state': async ({ services, params }) => {
    sessionOf(services, params.id)

    // a bare enum, not an object: the adapter calls `.trim()` on the answer, and
    // the capture recorded no shape here because there is no JSON body
    return { status: 200, body: 'idle' }
  },

  'DELETE /compute/sessions/{}': async ({ services, params }) => {
    sessionOf(services, params.id)

    estateOf(services).remove(params.id)

    return { status: 204, body: undefined }
  },

  'POST /compute/sessions/{}/jobs': async ({ services, params, request }) => {
    const session = sessionOf(services, params.id)
    const body = (request.body ?? {}) as {
      code?: string | string[]
      name?: string
      variables?: Record<string, string>
    }

    const job = estateOf(services).submit(session, body)
    const execute = services.viya?.execute

    // a host with an engine runs the program and the answer is what it produced;
    // a host without one keeps the generated log, which says so in its first line
    if (execute) {
      const ran = await execute({
        program: body.code ?? '',
        variables: body.variables,
        name: body.name,
        sessionId: session.id
      })

      job.webout = ran.webout
      job.log = ran.log.split('\n')
    }

    return { status: 201, body: jobBody(job) }
  },

  'GET /compute/sessions/{}/filerefs/_webout/content': async ({
    services,
    params
  }) => {
    const session = sessionOf(services, params.id)
    const webout = [...session.jobs.values()]
      .reverse()
      .find((job) => job.webout !== undefined)?.webout

    if (webout === undefined)
      throw new ApiError(
        404,
        'The session has no `_webout`: the host that mounts the emulator supplied no engine, so no program has run.'
      )

    return {
      status: 200,
      contents: webout,
      headers: { 'content-type': 'text/plain' }
    }
  },

  'GET /compute/sessions/{}/jobs/{}': async ({ services, params }) => {
    const [sessionId, jobId] = segmentsOf(params)

    return { status: 200, body: jobBody(jobOf(services, sessionId, jobId)) }
  },

  'GET /compute/sessions/{}/jobs/{}/state': async ({ services, params }) => {
    const [sessionId, jobId] = segmentsOf(params)

    return {
      status: 200,
      body: jobOf(services, sessionId, jobId).state
    }
  },

  'GET /compute/sessions/{}/jobs/{}/log/content': async ({
    services,
    params,
    request
  }) => {
    const [sessionId, jobId] = segmentsOf(params)
    const job = jobOf(services, sessionId, jobId)
    const start = Number(request.query?.start ?? 0) || 0
    const limit = Number(request.query?.limit ?? 0) || 0
    const lines = job.log.slice(start, limit ? start + limit : undefined)

    return {
      status: 200,
      body: {
        accept: 'application/json',
        name: 'content',
        start,
        limit: limit || lines.length,
        count: job.log.length,
        version: 2,
        items: lines.map((line) => ({ line, type: 'NOTE', version: 2 })),
        links: linksFor(
          `/compute/sessions/${job.sessionId}/jobs/${job.id}/log`,
          'application/vnd.sas.compute.job.log',
          false,
          true
        )
      }
    }
  }
}
