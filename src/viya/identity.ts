/**
 * The Viya identity answers an application reads for itself.
 *
 * The adapter asks Viya who the caller is and nothing else, so `/identities`
 * used to be one operation here. An application asks more than that: Data
 * Controller's group, user and deploy screens call the identity service
 * directly - `GET /identities/groups` twice on the deploy screen alone - and on
 * an emulated estate those calls answered 404, which is a screen a visitor
 * cannot use. `src/viya/appSurface.ts` is where those calls are declared, and
 * this is where they are answered.
 *
 * The estate has one identity: the store the package already serves the
 * administration routes from. That store is the project's `mock-identity.json`
 * on a mock site and the host's own records on a server, so a group named in the
 * fixture is the group this answers - nothing here invents a population. The
 * port is `RecordService` rather than `IdentityStore` because the administration
 * routes' gates belong with them: a caller with no account gets the same 401
 * here that it gets there.
 */
import type { ApiResponse, Services } from '../host/dispatch.js'
import { ApiError } from '../types.js'
import type { Subject } from '../identity/types.js'
import type { RecordService } from '../identity/records.js'
import { EMULATED_NOW } from './ids.js'

/** The port these handlers read, or the capability the host did not supply. */
export const requireRecords = (services: Services): RecordService => {
  if (!services.records)
    throw new ApiError(
      501,
      'The emulated identity answers from the records service, which this host does not supply.'
    )

  return services.records
}

/**
 * The caller, from the subject a host resolved or from the token it forwarded.
 *
 * A host that already knows its caller passes `subject`; one that hands the
 * emulator a bearer token (the server's Viya router does) gets the token read
 * here, exactly as `GET /identities/users/@currentUser` reads it. Neither is
 * optional in effect: an unauthenticated caller has no identity to answer about.
 */
const callerOf = async (
  services: Services,
  request: { subject?: Subject; token?: string }
): Promise<Subject | undefined> =>
  request.subject ?? (await services.identity?.authenticate(request.token))

/**
 * The `{}` a membership or avatar read was addressed to, as a uid.
 *
 * `@currentUser` is where Viya puts the caller's own account, and a client asks
 * for it by that spelling. It is resolved here rather than given its own row so
 * the handler has one shape to answer.
 */
const userIdFrom = (segment: string, caller: Subject | undefined): string => {
  if (segment.toLowerCase() !== '@currentuser') return segment

  const id = caller?.userId

  if (!id) throw new ApiError(401, 'No caller is signed in.')

  return id
}

/** The paging fields every collection answer carries, as the captured ones do. */
const collection = (
  name: string,
  items: unknown[],
  limit: number,
  uri: string,
  type: string
) => {
  const page = limit > 0 ? items.slice(0, limit) : items

  return {
    accept: 'application/json',
    name,
    start: 0,
    // the value asked for is echoed, as the folder answers echo it: a caller
    // that asked for five and is told zero cannot tell what happened
    limit: limit || page.length,
    count: page.length,
    version: 2,
    items: page,
    links: [
      {
        href: uri,
        uri,
        rel: 'self',
        method: 'GET',
        type: 'application/vnd.sas.collection',
        itemType: type
      }
    ]
  }
}

const identityLinks = (uri: string, type: string) => [
  { href: uri, uri, rel: 'self', method: 'GET', type }
]

const GROUP_TYPE = 'application/vnd.sas.identity.group'
const USER_TYPE = 'application/vnd.sas.identity.user'

/** A group as Viya represents one, from the store's record. */
const groupBody = (
  group: { uid: string; name: string; description: string },
  memberCount: number
) => ({
  id: group.uid,
  name: group.name,
  description: group.description,
  providerId: 'sas',
  state: 'active',
  memberCount,
  creationTimeStamp: EMULATED_NOW,
  modifiedTimeStamp: EMULATED_NOW,
  version: 1,
  links: identityLinks(`/identities/groups/${group.uid}`, GROUP_TYPE)
})

/** A user as Viya represents one. */
const userBody = (user: {
  uid: string
  username: string
  displayName: string
}) => ({
  id: user.uid,
  // Viya's `name` is the identifier a person signs in with; the display name is
  // a separate field, and this is the one a member list shows
  name: user.username,
  displayName: user.displayName,
  providerId: 'sas',
  state: 'active',
  version: 1,
  links: identityLinks(`/identities/users/${user.uid}`, USER_TYPE)
})

/** The groups a user is a member of, as Viya's memberships route answers them. */
const membershipsOf = async (
  records: RecordService,
  caller: Subject | undefined,
  uid: string
) => {
  const groups = await records.listGroups(caller)
  const found = []

  for (const group of groups) {
    const details = await records.getGroup(caller, { uid: group.uid })

    if (details.users.some((user) => user.uid === uid))
      found.push(groupBody(group, details.users.length))
  }

  return found
}

export const IDENTITY_HANDLERS: Record<
  string,
  (context: {
    services: Services
    request: {
      query?: Record<string, string | undefined>
      subject?: Subject
      token?: string
    }
    params: Record<string, string>
  }) => Promise<ApiResponse>
> = {
  'GET /identities/groups': async ({ services, request }) => {
    const records = requireRecords(services)
    const caller = await callerOf(services, request)
    const limit = Number(request.query?.limit ?? 0) || 0
    const sortBy = request.query?.sortBy

    const groups = await records.listGroups(caller)
    const items = []

    for (const group of groups) {
      const details = await records.getGroup(caller, { uid: group.uid })
      items.push(groupBody(group, details.users.length))
    }

    // `sortBy=name` is what the application asks for, and the store's order is
    // not one: a screen that lists groups alphabetically asks the service for it
    const ordered =
      sortBy && sortBy.toLowerCase() === 'name'
        ? [...items].sort((left, right) => left.name.localeCompare(right.name))
        : items

    return {
      status: 200,
      body: collection(
        'groups',
        ordered,
        limit,
        '/identities/groups',
        GROUP_TYPE
      )
    }
  },

  'GET /identities/groups/{}/members': async ({
    services,
    request,
    params
  }) => {
    const records = requireRecords(services)
    const caller = await callerOf(services, request)
    const limit = Number(request.query?.limit ?? 0) || 0

    const details = await records.getGroup(caller, { uid: params.id })
    const items = details.users.map((user) => userBody(user))

    return {
      status: 200,
      body: collection(
        'members',
        items,
        limit,
        `/identities/groups/${details.uid}/members`,
        USER_TYPE
      )
    }
  },

  'GET /identities/users': async ({ services, request }) => {
    const records = requireRecords(services)
    const caller = await callerOf(services, request)
    const limit = Number(request.query?.limit ?? 0) || 0

    const users = await records.listUsers(caller)

    return {
      status: 200,
      body: collection(
        'users',
        users.map((user) => userBody(user)),
        limit,
        '/identities/users',
        USER_TYPE
      )
    }
  },

  'GET /identities/users/{}': async ({ services, request, params }) => {
    const records = requireRecords(services)
    const caller = await callerOf(services, request)
    const uid = userIdFrom(params.id, caller)

    const user = await records.getUser(caller, { uid })

    return { status: 200, body: userBody(user) }
  },

  'GET /identities/users/@currentUser/memberships': async ({
    services,
    request
  }) => {
    const records = requireRecords(services)
    const caller = await callerOf(services, request)
    const limit = Number(request.query?.limit ?? 0) || 0
    const uid = userIdFrom('@currentUser', caller)

    const items = await membershipsOf(records, caller, uid)

    return {
      status: 200,
      body: collection(
        'memberships',
        items,
        limit,
        '/identities/users/@currentUser/memberships',
        GROUP_TYPE
      )
    }
  },

  'GET /identities/users/{}/memberships': async ({
    services,
    request,
    params
  }) => {
    const records = requireRecords(services)
    const caller = await callerOf(services, request)
    const limit = Number(request.query?.limit ?? 0) || 0
    const uid = userIdFrom(params.id, caller)

    // the address the client used is the address echoed back, as the other
    // answers do: a client that followed a rel is never told about another one
    const items = await membershipsOf(records, caller, uid)

    return {
      status: 200,
      body: collection(
        'memberships',
        items,
        limit,
        `/identities/users/${params.id}/memberships`,
        GROUP_TYPE
      )
    }
  },

  'GET /identities/users/{}/avatar/content': async ({
    services,
    request,
    params
  }) => {
    const caller = await callerOf(services, request)
    const uid = userIdFrom(params.id, caller)

    // the estate's identity carries no avatar, and Viya answers a 404 for an
    // account that has none - so a client's fallback image is what a real
    // estate with none would show it
    throw new ApiError(404, `No avatar is recorded for the user ${uid}.`)
  }
}
