/**
 * The compute family: contexts, sessions, jobs and the logs generated for them.
 *
 * These are the operations a `serverType=SASVIYA` application needs before it can
 * do anything: find a context, start a session, submit a program, poll it, read
 * its log. The emulator answers all of them from `EmulatedEstate` - this process -
 * because there is no SAS engine to reach for in a browser and no reason to reach
 * for one here.
 *
 * The emulated estate has one context. Its list, detail and session creation
 * share its fixed identity; a filter cannot rename it.
 */
import type { ApiResponse, Services } from '../host/dispatch.js'
import type { Subject } from '../identity/types.js'
import { ApiError } from '../types.js'
import { estateKeyOf, normaliseServerUrl, seedOf } from './seed.js'
import { estateFor, type EmulatedJob, type SessionOwner } from './sessions.js'
import { idFor, callerId, EMULATED_NOW } from './ids.js'

/** The one mock context, selected explicitly by clients. */
export const DEFAULT_CONTEXT_NAME = 'SASjs Mock context'

/** The fixed id of the one emulated context. */
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

const estateOf = (services: Services) =>
  estateFor(estateKeyOf(services.viya), seedOf(services.viya))

/**
 * Read only the simple equality filter used by the adapter. Single-quoted
 * names are also supported for existing mock clients. Escapes, other operators
 * and compound expressions are refused rather than guessed.
 */
export const contextNameFrom = (filter: unknown): string => {
  if (filter === undefined) return DEFAULT_CONTEXT_NAME

  const match =
    typeof filter === 'string'
      ? /^\s*eq\(\s*name\s*,\s*(?:'([^'\\]*)'|"([^"\\]*)")\s*\)\s*$/.exec(
          filter
        )
      : null
  if (!match)
    throw new ApiError(
      400,
      'Unsupported compute context filter. Use eq(name, "...").'
    )

  return match[1] ?? match[2]
}

const contextBody = (name: string, caller: string) => ({
  id: EMULATED_CONTEXT_ID,
  name,
  createdBy: caller,
  version: 2,
  links: linksFor(
    `/compute/contexts/${EMULATED_CONTEXT_ID}`,
    'application/vnd.sas.compute.context'
  )
})

/**
 * The context in full, for the read a client makes of one it already holds.
 *
 * The list view Viya answers is deliberately minimal, so a client that needs a
 * context's attributes reads the context itself - Data Controller's deploy
 * screen fetches each one to pick up its batch identity. The attributes are the
 * ones an emulated estate truthfully has: nothing runs as a batch identity here,
 * and `reuseServerProcesses` is `false` for the same reason, which is what leaves
 * a client's batch-id list empty rather than inventing an account to run as.
 */
const contextDetailsBody = (caller: string) => ({
  ...contextBody(DEFAULT_CONTEXT_NAME, caller),
  description: 'The compute context an emulated estate answers for',
  creationTimeStamp: EMULATED_NOW,
  modifiedTimeStamp: EMULATED_NOW,
  modifiedBy: caller,
  launchType: 'service',
  launchContext: { contextId: EMULATED_CONTEXT_ID },
  environment: { autoExecLines: [] },
  attributes: {
    reuseServerProcesses: 'false',
    allowXCMD: 'false',
    serverMinAvailable: '1'
  }
})

const sessionBody = (
  services: Services,
  session: { id: string; createdAt: string },
  autoExecLines: string[],
  caller: string
) => {
  const { id } = session
  const uri = `/compute/sessions/${id}`

  return {
    id,
    applicationName: 'emulated',
    owner: caller,
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
    ...(job.completedTimeStamp
      ? { completedTimeStamp: job.completedTimeStamp }
      : {}),
    jobConditionCode: 0,
    stateElapsedTime: 1,
    listingStatistics: {
      lineCount: job.log.length,
      modifiedTimeStamp: job.completedTimeStamp ?? job.creationTimeStamp
    },
    logStatistics: {
      lineCount: job.log.length,
      modifiedTimeStamp: job.completedTimeStamp ?? job.creationTimeStamp
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

/** The browser mock has an anonymous principal distinct from every named user. */
const ownerOf = (subject: Subject | undefined): SessionOwner => {
  if (subject === undefined) return { kind: 'anonymous' }
  if (!subject || typeof subject.userId !== 'string' || !subject.userId.trim())
    throw new ApiError(401, 'A valid caller is required.')

  if (subject.ownerId === undefined)
    return { kind: 'user', key: subject.userId }
  if (typeof subject.ownerId !== 'string' || !subject.ownerId.trim())
    throw new ApiError(401, 'A valid caller is required.')

  return { kind: 'account', key: subject.ownerId }
}

/** Ownerless records cannot be attributed and are deliberately inaccessible. */
const sessionOf = (services: Services, id: string, subject?: Subject) => {
  const owner = ownerOf(subject)
  const session = estateOf(services).session(id)

  if (
    !session ||
    !session.owner ||
    session.owner.kind !== owner.kind ||
    session.owner.key !== owner.key
  )
    throw new ApiError(404, `Session with ID '${id}' was not found.`)

  return session
}

const jobOf = (
  services: Services,
  sessionId: string,
  jobId: string,
  subject?: Subject
) => {
  const job = sessionOf(services, sessionId, subject).jobs.get(jobId)

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
      subject?: Subject
    }
    params: Record<string, string>
  }) => Promise<ApiResponse>
> = {
  'GET /compute/contexts': async ({ request }) => {
    if (request.query?.sortBy !== undefined)
      throw new ApiError(400, 'Unsupported compute context sortBy.')
    const limitText: unknown = request.query?.limit
    const startText: unknown = request.query?.start
    const limitValue = limitText === undefined ? '10' : limitText
    const startValue = startText === undefined ? '0' : startText
    if (
      typeof startValue !== 'string' ||
      typeof limitValue !== 'string' ||
      !/^\d+$/.test(startValue) ||
      !/^\d+$/.test(limitValue) ||
      !Number.isSafeInteger(Number(startValue)) ||
      !Number.isSafeInteger(Number(limitValue))
    )
      throw new ApiError(
        400,
        'Unsupported compute context pagination. Use non-negative integers for start and limit.'
      )
    const start = Number(startValue)
    const limit = Number(limitValue)
    const matches =
      contextNameFrom(request.query?.filter) === DEFAULT_CONTEXT_NAME
        ? [contextBody(DEFAULT_CONTEXT_NAME, callerId(request.subject))]
        : []

    return {
      status: 200,
      body: {
        accept: 'application/json',
        name: 'contexts',
        start,
        limit,
        count: matches.length,
        version: 2,
        items: matches.slice(start, start + limit),
        links: linksFor(
          '/compute/contexts',
          'application/vnd.sas.compute.context',
          true
        )
      }
    }
  },

  'GET /compute/contexts/{}': async ({ request, params }) => {
    // the estate has one context and its id does not move, so an id it is not is
    // an id no context here ever had - the same refusal the drive makes for an
    // unknown folder rather than a body about some other context
    if (params.id !== EMULATED_CONTEXT_ID)
      throw new ApiError(
        404,
        `No compute context matches the id ${params.id}. The emulated estate answers one context, and this is not its id.`
      )

    return { status: 200, body: contextDetailsBody(callerId(request.subject)) }
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

    const session = estateOf(services).create(ownerOf(request.subject))

    return {
      status: 201,
      body: sessionBody(
        services,
        session,
        body.environment?.autoExecLines ?? [],
        callerId(request.subject)
      )
    }
  },

  'GET /compute/sessions/{}/state': async ({ services, params, request }) => {
    sessionOf(services, params.id, request.subject)

    // a bare enum, not an object: the adapter calls `.trim()` on the answer, and
    // the capture recorded no shape here because there is no JSON body
    return { status: 200, body: 'idle' }
  },

  'DELETE /compute/sessions/{}': async ({ services, params, request }) => {
    sessionOf(services, params.id, request.subject)

    estateOf(services).remove(params.id)

    return { status: 204, body: undefined }
  },

  'POST /compute/sessions/{}/jobs': async ({ services, params, request }) => {
    const session = sessionOf(services, params.id, request.subject)
    const body = (request.body ?? {}) as {
      code?: string | string[]
      name?: string
      variables?: Record<string, string>
    }

    const job = estateOf(services).submit(session, body)
    const execute = services.viya?.execute

    // a host with no engine has nothing to run, so the job is finished at once
    if (!execute) {
      job.state = 'completed'
      job.completedTimeStamp = new Date().toISOString()

      return { status: 201, body: jobBody(job) }
    }

    // the 201 is the submission, not the run: the client polls the state link,
    // and `waitForResult: false` is documented to return here and poll later
    job.state = 'running'

    // and there is no log yet: the generated lines are what a host with NO engine
    // answers, including one that says the run completed, so a running job must
    // not advertise them - the run writes the log when it has one
    job.log = []

    void execute({
      program: body.code ?? '',
      variables: body.variables,
      name: body.name,
      sessionId: session.id
    })
      .then((ran) => {
        job.log = ran.log.split('\n')
        job.state = ran.state ?? 'completed'

        if (ran.webout !== undefined) job.webout = ran.webout

        job.completedTimeStamp = new Date().toISOString()
      })
      .catch((error: unknown) => {
        // a run that threw is a failed job with the reason in its log, because a
        // client reads the failure from the state and the log together
        job.state = 'failed'
        job.log = [`ERROR: ${(error as Error).message}`]
        job.completedTimeStamp = new Date().toISOString()
      })

    return { status: 201, body: jobBody(job) }
  },

  'GET /compute/sessions/{}/filerefs/_webout/content': async ({
    services,
    params,
    request
  }) => {
    const session = sessionOf(services, params.id, request.subject)
    const last = [...session.jobs.values()].pop()

    if (!last)
      throw new ApiError(
        404,
        'This session has no `_webout` yet: nothing has run in it.'
      )

    // the answer belongs to the last job submitted, not to the newest one that
    // happened to produce something: a failed service must not answer with an
    // earlier service's data
    if (last.webout === undefined)
      throw new ApiError(
        404,
        last.state === 'running'
          ? `This session has no \`_webout\` yet: job '${last.id}' has not finished.`
          : services.viya?.execute
            ? `This session has no \`_webout\`: job '${last.id}' ran and produced none.`
            : `This session has no \`_webout\`: the host supplied no engine, so no program has run.`
      )

    return {
      status: 200,
      contents: last.webout,
      headers: { 'content-type': 'text/plain' }
    }
  },

  'GET /compute/sessions/{}/jobs/{}': async ({ services, params, request }) => {
    const [sessionId, jobId] = segmentsOf(params)

    return {
      status: 200,
      body: jobBody(jobOf(services, sessionId, jobId, request.subject))
    }
  },

  'GET /compute/sessions/{}/jobs/{}/state': async ({
    services,
    params,
    request
  }) => {
    const [sessionId, jobId] = segmentsOf(params)

    return {
      status: 200,
      body: jobOf(services, sessionId, jobId, request.subject).state
    }
  },

  'GET /compute/sessions/{}/jobs/{}/log/content': async ({
    services,
    params,
    request
  }) => {
    const [sessionId, jobId] = segmentsOf(params)
    const job = jobOf(services, sessionId, jobId, request.subject)
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
