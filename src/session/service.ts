import { ApiError } from '../types.js'
import type { Subject } from '../identity/types.js'
import type { IdentityUserRecord } from '../identity/types.js'

/** A triggered session as the API reports one. */
export interface SessionSummary {
  sessionId: string
  state: string
  pid?: number
  creationTimeStamp?: string
  deathTimeStamp?: string
  failureReason?: string
  expiresAfterMins?: number
}

/** What `/state` answers: whatever the host's run time reports for a session. */
export type SessionStateResponse = Record<string, unknown>

/**
 * A session as the host holds it.
 *
 * `owner` should be a **uid**: a username is mutable client data - an account
 * can be renamed, and two accounts can swap names - so a name comparison can
 * hand a session to whoever holds the name later. A username is accepted too,
 * because sasjs/server's own session records carry the owner's username, and a
 * host that hands those straight through the port must not 404 the owner of
 * every session. The uid is tried first; the name is the fallback.
 */
export interface HostSession {
  owner: string
  summary: SessionSummary
}

/**
 * The host's sessions: a run time's registry, and the files that session wrote.
 *
 * Every capability answers `undefined` for a session the host does not hold,
 * which the service turns into a 404. `log` and `output` answer an empty string
 * for one that exists but has written nothing yet, because that is not an error.
 */
export interface SessionHost {
  session(id: string): Promise<HostSession | undefined>
  state(id: string): Promise<SessionStateResponse | undefined>
  log(id: string): Promise<string | undefined>
  output(id: string): Promise<string | undefined>
}

/**
 * What the session service needs to know about a caller.
 *
 * One method, because one is all it reads: who the caller is, whether the
 * account is still active, and whether it is an administrator. An `IdentityStore`
 * satisfies this structurally, so a host that already has one passes it
 * unchanged; a host whose identity lives in its own models implements four lines
 * instead of an entire store it would otherwise have to fake.
 */
export interface CallerDirectory {
  userById(uid: string): Promise<IdentityUserRecord | undefined>
}

export interface SessionService {
  summary(caller: Subject | undefined, id: string): Promise<SessionSummary>
  state(caller: Subject | undefined, id: string): Promise<SessionStateResponse>
  log(caller: Subject | undefined, id: string): Promise<string>
  output(caller: Subject | undefined, id: string): Promise<string>
}

/**
 * The four session routes, over the host's own session store.
 *
 * The caller passes a `Subject` and nothing else: which account that is, whether
 * it is an administrator, and whether the session is theirs are all resolved
 * here, against the same store the records service reads. A host never states a
 * role.
 *
 * `404` covers both "no such session" and "not yours", on purpose: a session id
 * is handed to the caller that triggered the program and is built from a
 * timestamp plus a small random number, so it is guessable within a window, and
 * confirming the id exists would say it was right.
 */
export const createSessionService = (
  directory: CallerDirectory,
  host: SessionHost
): SessionService => {
  /** The server's wording, so adopting it here does not become a later change. */
  const notFound = (id: string) => `Session with ID '${id}' was not found.`

  /** The caller, and the session if they may see it - or the 404 that hides it. */
  const visible = async (
    caller: Subject | undefined,
    id: string
  ): Promise<HostSession> => {
    if (!caller) throw new ApiError(401, 'Unauthorized')

    const reader: IdentityUserRecord | undefined = await directory.userById(
      caller.userId
    )
    if (!reader || !reader.isActive) throw new ApiError(401, 'Unauthorized')

    const session = await host.session(id)
    if (!session) throw new ApiError(404, notFound(id))

    // the uid is the key to compare; a name is the fallback a host may need
    const owner = session.owner
    if (owner !== reader.uid && owner !== reader.username && !reader.isAdmin)
      throw new ApiError(404, notFound(id))

    return session
  }

  return {
    async summary(caller, id) {
      const session = await visible(caller, id)
      return session.summary
    },

    async state(caller, id) {
      await visible(caller, id)
      const state = await host.state(id)
      if (!state) throw new ApiError(404, notFound(id))
      return state
    },

    async log(caller, id) {
      await visible(caller, id)
      const log = await host.log(id)
      if (log === undefined) throw new ApiError(404, notFound(id))
      return log
    },

    async output(caller, id) {
      await visible(caller, id)
      const output = await host.output(id)
      if (output === undefined) throw new ApiError(404, notFound(id))
      return output
    }
  }
}
