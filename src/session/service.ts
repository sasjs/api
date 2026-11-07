import { ApiError } from '../types.js'
import type { Subject } from '../identity/types.js'
import type { IdentityStore, IdentityUserRecord } from '../identity/types.js'

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
 * `owner` is a **uid**, not a username. A username is mutable client data - an
 * administrator can rename an account, and two accounts can swap names - so a
 * name comparison can hand a session to whoever holds the name later. A host
 * whose session store keeps usernames maps them to the uid when it implements
 * this port.
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
  store: IdentityStore,
  host: SessionHost
): SessionService => {
  const NOT_FOUND = 'Session not found.'

  /** The caller, and the session if they may see it - or the 404 that hides it. */
  const visible = async (
    caller: Subject | undefined,
    id: string
  ): Promise<HostSession> => {
    if (!caller) throw new ApiError(401, 'Unauthorized')

    const reader: IdentityUserRecord | undefined = await store.userById(
      caller.userId
    )
    if (!reader || !reader.isActive) throw new ApiError(401, 'Unauthorized')

    const session = await host.session(id)
    if (!session) throw new ApiError(404, NOT_FOUND)
    if (session.owner !== reader.uid && !reader.isAdmin)
      throw new ApiError(404, NOT_FOUND)

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
      if (!state) throw new ApiError(404, NOT_FOUND)
      return state
    },

    async log(caller, id) {
      await visible(caller, id)
      const log = await host.log(id)
      if (log === undefined) throw new ApiError(404, NOT_FOUND)
      return log
    },

    async output(caller, id) {
      await visible(caller, id)
      const output = await host.output(id)
      if (output === undefined) throw new ApiError(404, NOT_FOUND)
      return output
    }
  }
}
