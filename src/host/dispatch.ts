/**
 * One dispatcher, so the corpus can speak HTTP without a server.
 *
 * Both hosts own their transport - express with multer on one side, a service
 * worker reading `Request` objects on the other - and neither owns the
 * decisions. This file is the seam: it takes the request in the shape the
 * table describes and calls the service, and it is what the corpus runs
 * against.
 *
 * It also does the validation the table can express (a required parameter is
 * required), because repeating that list in each host is how the two answer
 * differently - the same failure the header seed and the webout block had.
 */
import type { Route } from '../types.js'
import { routeById } from '../routes/index.js'
import type { DriveService } from '../drive/service.js'
import type { IdentityService } from '../identity/service.js'
import type { RecordService } from '../identity/records.js'
import type { SessionService } from '../session/service.js'
import type { CodeService } from '../code/service.js'
import type { Subject } from '../identity/types.js'
import { ApiError } from '../types.js'
import { DEPLOY_SUCCESS } from '../drive/deploy.js'

/** The defaults sasjs/server's Client schema applies to an omitted lifetime. */
const SECONDS_IN_A_DAY = 86400

export interface ApiRequest {
  query?: Record<string, string | undefined>
  body?: Record<string, unknown>
  /**
   * The values the route's path parameters carried, by name - `{ uid: 'abc' }`
   * for `/user/{uid}`. A host extracts them from its own router; the corpus
   * states them.
   */
  params?: Record<string, string>
  /** The multipart payload: the API names it `file` on every route that takes one. */
  file?: { name: string; contents: string | Uint8Array }
  /**
   * The bearer token the request carried, for the routes that name their caller
   * in a header rather than a body. A host that already resolved the caller - a
   * session cookie - passes `subject` instead.
   */
  token?: string
  /** The caller, when the host resolved one before dispatching. */
  subject?: Subject
}

export interface ApiResponse {
  status: number
  /** A JSON body. */
  body?: unknown
  /** A raw body, for the one route that answers with the file itself. */
  contents?: string | Uint8Array
}

export interface Services {
  /** The editor routes, where the host supplies a linter. */
  code?: CodeService
  drive: DriveService
  /**
   * Users, clients and tokens. A host without one answers 501 for the identity
   * routes, which is the same answer as an operation this package does not
   * implement - the difference is the message, and it names the capability.
   */
  identity?: IdentityService
  /** Users, groups, permission rules and clients. Absent, the record routes answer 501. */
  records?: RecordService
  /**
   * A triggered session's record, log, output and state. A host without one
   * answers 501 for these four, naming the capability.
   */
  session?: SessionService
}

/**
 * The parameters the table marks required, checked before the handler runs.
 *
 * Multipart fields are deliberately left to the handler: the payload carries the
 * file itself, and the server words a missing one as `"file" is not present.`
 * rather than `"file" is required` - a distinction a client may already key on.
 */
const validate = (route: Route, request: ApiRequest): void => {
  for (const param of route.params) {
    if (!param.required || param.in === 'formData' || param.in === 'header')
      continue
    // a path parameter comes from the matcher, not from the caller's payload, so
    // it is the host's job to have supplied it
    if (param.in === 'path') continue
    const given =
      param.in === 'query'
        ? request.query?.[param.name]
        : (request.body?.[param.name] as string | undefined)
    // missing and empty are two refusals, the way the schema has them: a
    // client that sent the field an empty value has a different bug from one
    // that omitted it
    if (given === undefined)
      throw new ApiError(400, `"${param.name}" is required`)
    if (given === '')
      throw new ApiError(400, `"${param.name}" is not allowed to be empty`)
  }
}

/** The drive path a write names: the query parameter wins over the form field. */
const targetPath = (request: ApiRequest): string => {
  const fromQuery = request.query?._filePath
  const fromBody = request.body?.filePath
  const path =
    fromQuery !== undefined
      ? String(fromQuery)
      : (fromBody as string | undefined)
  // neither given: the server's validation answers for the query parameter
  if (path === undefined) throw new ApiError(400, '"_filePath" is required')
  return path
}

export const dispatch = async (
  services: Services,
  routeId: string,
  request: ApiRequest = {}
): Promise<ApiResponse> => {
  const route = routeById(routeId)
  if (!route) throw new ApiError(404, `No such operation: ${routeId}`)

  const { drive, identity, records, code } = services

  // The server authenticates before its payload schema runs, so an anonymous
  // request with an incomplete body is a 401 there rather than a 400. The order
  // is only observable on the route groups that gate on a caller: the sign-in
  // flow has no caller by definition, and the drive has no identity at all.
  const identityScoped =
    ['User', 'Group', 'Permission', 'Client'].includes(route.tag) ||
    routeId === 'PATCH /SASjsApi/auth/updatePassword'

  if (identityScoped && records) {
    const subject =
      request.subject ??
      (identity ? await identity.authenticate(request.token) : undefined)

    if (!subject) {
      // A host may serve records without a sign-in flow - it resolves the caller
      // itself and passes `subject`. Without one it cannot authenticate at all,
      // and a 401 would send every request round the login loop for ever, so it
      // is told which capability it is missing instead.
      if (!identity)
        throw new ApiError(
          501,
          `This host has no identity service, so it cannot answer ${routeId}.`
        )
      throw new ApiError(401, 'Unauthorized')
    }
  }

  validate(route, request)

  const query = request.query || {}
  const body = request.body || {}
  const params = request.params || {}

  /** The record service, or the 501 a host without one answers. */
  /** The host's sessions, or the 501 that names the missing capability. */
  const sessionRequired = (): SessionService => {
    if (!services.session)
      throw new ApiError(
        501,
        `This host has no session service, so it cannot answer ${routeId}.`
      )
    return services.session
  }

  const required = (): RecordService => {
    if (!records)
      throw new ApiError(
        501,
        `This host has no record service, so it cannot answer ${routeId}.`
      )
    return records
  }

  /** The caller, from the request's own subject or the token it carried. */
  const caller = async (): Promise<Subject | undefined> => {
    if (request.subject) return request.subject
    return identity?.authenticate(request.token)
  }

  if (
    routeId.startsWith('POST /SASjsApi/auth/') ||
    routeId.startsWith('POST /SASLogon/') ||
    routeId === 'GET /SASLogon/logout' ||
    routeId === 'GET /SASjsApi/session'
  ) {
    if (!identity)
      throw new ApiError(
        501,
        `This host has no identity service, so it cannot answer ${routeId}.`
      )

    switch (routeId) {
      case 'POST /SASjsApi/auth/token':
        return {
          status: 200,
          body: await identity.token({
            clientId: String(body.clientId ?? ''),
            code: body.code as string
          })
        }
      case 'POST /SASjsApi/auth/refresh':
        return { status: 200, body: await identity.refresh(request.token) }
      case 'POST /SASjsApi/auth/logout':
        await identity.logout(await caller())
        return { status: 204 }
      case 'POST /SASLogon/login':
        return {
          status: 200,
          body: await identity.login({
            username: String(body.username ?? ''),
            password: String(body.password ?? '')
          })
        }
      case 'POST /SASLogon/authorize':
        return {
          status: 200,
          body: {
            code: await identity.authorize(
              await caller(),
              String(body.clientId ?? '')
            )
          }
        }
      case 'GET /SASLogon/logout':
        return { status: 200, contents: await identity.logoutSession() }
      case 'GET /SASjsApi/session':
        return { status: 200, body: await identity.session(await caller()) }
    }
  }

  switch (routeId) {
    case 'GET /SASjsApi/drive/file': {
      const file = await drive.read(String(query._filePath || ''))
      return { status: 200, contents: file.contents }
    }
    case 'POST /SASjsApi/drive/file':
    case 'PATCH /SASjsApi/drive/file': {
      if (!request.file) throw new ApiError(400, '"file" is not present.')
      const path = targetPath(request)
      const result =
        routeId === 'PATCH /SASjsApi/drive/file'
          ? await drive.update(path, request.file.contents)
          : await drive.save(path, request.file.contents)
      return { status: 200, body: result }
    }
    case 'DELETE /SASjsApi/drive/file':
      return {
        status: 200,
        body: await drive.remove(String(query._filePath || ''))
      }

    case 'GET /SASjsApi/drive/folder':
      return { status: 200, body: await drive.list(query._folderPath) }

    case 'POST /SASjsApi/drive/folder':
      return {
        status: 200,
        body: await drive.mkdir(String(request.body?.folderPath || ''))
      }

    case 'DELETE /SASjsApi/drive/folder':
      return {
        status: 200,
        body: await drive.rmdir(String(query._folderPath || ''))
      }

    case 'POST /SASjsApi/drive/rename':
      return {
        status: 200,
        body: await drive.rename(
          String(request.body?.oldPath || ''),
          String(request.body?.newPath || '')
        )
      }

    case 'POST /SASjsApi/drive/deploy': {
      // `streamWebFolder` is the host's: publishing an app stream is not a drive
      // operation, and a host that has no app stream ignores it.
      await drive.deploy(String(body.appLoc ?? ''), body.fileTree)

      return { status: 200, body: DEPLOY_SUCCESS }
    }

    case 'GET /SASjsApi/drive/filetree':
      return { status: 200, body: await drive.tree(query._folderPath) }

    // ------------------------------------------------------------- sessions
    case 'GET /SASjsApi/session/{sessionId}': {
      return {
        status: 200,
        body: await sessionRequired().summary(
          await caller(),
          String(params.sessionId ?? '')
        )
      }
    }

    case 'GET /SASjsApi/session/{sessionId}/log': {
      return {
        status: 200,
        contents: await sessionRequired().log(
          await caller(),
          String(params.sessionId ?? '')
        )
      }
    }

    case 'GET /SASjsApi/session/{sessionId}/output': {
      return {
        status: 200,
        contents: await sessionRequired().output(
          await caller(),
          String(params.sessionId ?? '')
        )
      }
    }

    case 'GET /SASjsApi/session/{sessionId}/state': {
      return {
        status: 200,
        body: await sessionRequired().state(
          await caller(),
          String(params.sessionId ?? '')
        )
      }
    }

    // ------------------------------------------------------------- records
    //
    // The administration routes: users, groups, permission rules, clients and the
    // caller's own password. Each handler resolves the caller and passes it on;
    // the admin gate and the wording live in the service.

    case 'GET /SASjsApi/user':
      return { status: 200, body: await required().listUsers(await caller()) }
    case 'GET /SASjsApi/user/{uid}':
      return {
        status: 200,
        body: await required().getUser(await caller(), {
          uid: String(params.uid ?? '')
        })
      }
    case 'GET /SASjsApi/user/by/username/{username}':
      return {
        status: 200,
        body: await required().getUser(await caller(), {
          username: String(params.username ?? '')
        })
      }
    case 'POST /SASjsApi/user':
      return {
        status: 200,
        body: await required().createUser(await caller(), {
          username: String(body.username ?? ''),
          displayName: String(body.displayName ?? ''),
          password: String(body.password ?? ''),
          isAdmin: body.isAdmin as boolean | undefined,
          isActive: body.isActive as boolean | undefined,
          autoExec: body.autoExec as string | undefined
        })
      }
    case 'PATCH /SASjsApi/user/{uid}':
      return {
        status: 200,
        body: await required().updateUser(
          await caller(),
          { uid: String(params.uid ?? '') },
          body
        )
      }
    case 'PATCH /SASjsApi/user/by/username/{username}':
      return {
        status: 200,
        body: await required().updateUser(
          await caller(),
          { username: String(params.username ?? '') },
          body
        )
      }
    case 'DELETE /SASjsApi/user/{uid}':
      return {
        status: 200,
        body: await required().deleteUser(
          await caller(),
          { uid: String(params.uid ?? '') },
          { password: body.password as string | undefined }
        )
      }
    case 'DELETE /SASjsApi/user/by/username/{username}':
      return {
        status: 200,
        body: await required().deleteUser(
          await caller(),
          { username: String(params.username ?? '') },
          { password: body.password as string | undefined }
        )
      }

    case 'POST /SASjsApi/code/lint':
      if (!code)
        throw new ApiError(
          501,
          `This host has no code service, so it cannot answer ${routeId}.`
        )
      return {
        status: 200,
        body: await code.lint(await caller(), {
          code: body.code as string,
          filePath: body.filePath as string | undefined
        })
      }
    case 'POST /SASjsApi/code/format':
      if (!code)
        throw new ApiError(
          501,
          `This host has no code service, so it cannot answer ${routeId}.`
        )
      return {
        status: 200,
        body: await code.format(await caller(), {
          code: body.code as string,
          filePath: body.filePath as string | undefined
        })
      }

    case 'GET /SASjsApi/info/authorizedRoutes':
      return {
        status: 200,
        body: await required().listAuthorizedRoutes(await caller())
      }
    case 'GET /SASjsApi/info/myAuthorizedRoutes':
      return {
        status: 200,
        body: await required().myAuthorizedRoutes(await caller())
      }

    case 'GET /SASjsApi/group':
      return { status: 200, body: await required().listGroups(await caller()) }
    case 'GET /SASjsApi/group/{uid}':
      return {
        status: 200,
        body: await required().getGroup(await caller(), {
          uid: String(params.uid ?? '')
        })
      }
    case 'GET /SASjsApi/group/by/groupname/{name}':
      return {
        status: 200,
        body: await required().getGroup(await caller(), {
          name: String(params.name ?? '')
        })
      }
    case 'POST /SASjsApi/group':
      return {
        status: 200,
        body: await required().createGroup(await caller(), {
          name: String(body.name ?? ''),
          description: String(body.description ?? ''),
          isActive: body.isActive as boolean | undefined
        })
      }
    case 'POST /SASjsApi/group/{groupUid}/{userUid}':
      return {
        status: 200,
        body: await required().addUserToGroup(
          await caller(),
          String(params.groupUid ?? ''),
          String(params.userUid ?? '')
        )
      }
    case 'DELETE /SASjsApi/group/{groupUid}/{userUid}':
      return {
        status: 200,
        body: await required().removeUserFromGroup(
          await caller(),
          String(params.groupUid ?? ''),
          String(params.userUid ?? '')
        )
      }
    case 'DELETE /SASjsApi/group/{uid}':
      // the document states 200 for this one - the server answers with the
      // driver's delete result rather than nothing
      await required().deleteGroup(await caller(), String(params.uid ?? ''))
      return { status: 200 }

    case 'GET /SASjsApi/permission':
      return {
        status: 200,
        body: await required().listPermissions(await caller())
      }
    case 'POST /SASjsApi/permission':
      return {
        status: 200,
        body: await required().createPermission(await caller(), {
          path: String(body.path ?? ''),
          type: String(body.type ?? ''),
          setting: String(body.setting ?? ''),
          principalType: String(body.principalType ?? ''),
          principalId: String(body.principalId ?? '')
        })
      }
    case 'PATCH /SASjsApi/permission/{uid}':
      return {
        status: 200,
        body: await required().updatePermission(
          await caller(),
          String(params.uid ?? ''),
          { setting: String(body.setting ?? '') }
        )
      }
    case 'DELETE /SASjsApi/permission/{uid}':
      return {
        status: 200,
        body: await required().deletePermission(
          await caller(),
          String(params.uid ?? '')
        )
      }

    case 'GET /SASjsApi/client':
      return { status: 200, body: await required().listClients(await caller()) }
    case 'POST /SASjsApi/client':
      return {
        status: 200,
        // An omitted lifetime is the schema's default, not NaN: the server's
        // Client model declares 86400 and 2592000, and a NaN lifetime would make
        // every token the client buys expire on arrival.
        body: await required().createClient(await caller(), {
          clientId: String(body.clientId ?? ''),
          clientSecret: String(body.clientSecret ?? ''),
          accessTokenExpiration:
            body.accessTokenExpiration === undefined
              ? SECONDS_IN_A_DAY
              : Number(body.accessTokenExpiration),
          refreshTokenExpiration:
            body.refreshTokenExpiration === undefined
              ? SECONDS_IN_A_DAY * 30
              : Number(body.refreshTokenExpiration)
        })
      }

    case 'PATCH /SASjsApi/auth/updatePassword':
      await required().updatePassword(await caller(), {
        currentPassword: String(body.currentPassword ?? ''),
        newPassword: String(body.newPassword ?? '')
      })
      return { status: 204 }

    default: {
      // The reason the table carries travels with the refusal: a host developer
      // reading a 501 wants to know what the operation waits on, not only that
      // it is missing.
      const reason = routeById(routeId)?.reason

      throw new ApiError(
        501,
        `This package has no handler for ${routeId}.${reason ? ` ${reason}` : ''}`
      )
    }
  }
}

/** Whether a route is one `dispatch` can answer today. */
export const HANDLED_ROUTES: string[] = [
  'GET /SASjsApi/session/{sessionId}',
  'GET /SASjsApi/session/{sessionId}/log',
  'GET /SASjsApi/session/{sessionId}/output',
  'GET /SASjsApi/session/{sessionId}/state',
  'POST /SASjsApi/code/lint',
  'POST /SASjsApi/code/format',
  'GET /SASjsApi/info/authorizedRoutes',
  'GET /SASjsApi/info/myAuthorizedRoutes',
  'GET /SASjsApi/drive/file',
  'POST /SASjsApi/drive/file',
  'PATCH /SASjsApi/drive/file',
  'DELETE /SASjsApi/drive/file',
  'GET /SASjsApi/drive/folder',
  'POST /SASjsApi/drive/folder',
  'DELETE /SASjsApi/drive/folder',
  'POST /SASjsApi/drive/rename',
  'GET /SASjsApi/drive/filetree',
  'POST /SASjsApi/drive/deploy',
  'POST /SASjsApi/auth/token',
  'POST /SASjsApi/auth/refresh',
  'POST /SASjsApi/auth/logout',
  'POST /SASLogon/login',
  'POST /SASLogon/authorize',
  'GET /SASLogon/logout',
  'GET /SASjsApi/session',
  'GET /SASjsApi/user',
  'GET /SASjsApi/user/{uid}',
  'GET /SASjsApi/user/by/username/{username}',
  'POST /SASjsApi/user',
  'PATCH /SASjsApi/user/{uid}',
  'PATCH /SASjsApi/user/by/username/{username}',
  'DELETE /SASjsApi/user/{uid}',
  'DELETE /SASjsApi/user/by/username/{username}',
  'GET /SASjsApi/group',
  'GET /SASjsApi/group/{uid}',
  'GET /SASjsApi/group/by/groupname/{name}',
  'POST /SASjsApi/group',
  'POST /SASjsApi/group/{groupUid}/{userUid}',
  'DELETE /SASjsApi/group/{groupUid}/{userUid}',
  'DELETE /SASjsApi/group/{uid}',
  'GET /SASjsApi/permission',
  'POST /SASjsApi/permission',
  'PATCH /SASjsApi/permission/{uid}',
  'DELETE /SASjsApi/permission/{uid}',
  'GET /SASjsApi/client',
  'POST /SASjsApi/client',
  'PATCH /SASjsApi/auth/updatePassword'
]
