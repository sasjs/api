/**
 * The sign-in flow's decisions: what each route answers, in which order, with
 * which wording.
 *
 * The transport stays with the host - a session cookie and a CSRF token on a
 * server, whatever the browser build holds - so nothing here reads a request.
 * A host resolves the caller (a bearer token through `authenticate`, a session
 * it already has) and passes the subject in; the service decides whether that
 * is enough for the operation to proceed.
 */
import { ApiError } from '../types.js'
import type {
  IdentityStore,
  IdentityUser,
  Subject,
  TokenPair
} from './types.js'

export interface LoginResult {
  loggedIn: boolean
  user: {
    uid: string
    username: string
    displayName: string
    isAdmin: boolean
    needsToUpdatePassword: boolean
  }
}

export interface SessionResult {
  uid: string
  username: string
  displayName: string
  isAdmin: boolean
  needsToUpdatePassword: boolean
}

export interface IdentityService {
  /**
   * The subject an access token names, or undefined. A host that already knows
   * its caller - a session cookie - does not need this.
   */
  authenticate(token: string | undefined): Promise<Subject | undefined>
  login(credentials: {
    username: string
    password: string
  }): Promise<LoginResult>
  /** The authorization code a signed-in caller exchanges for tokens. */
  authorize(subject: Subject | undefined, clientId: string): Promise<string>
  /** The token pair an authorization code buys. */
  token(request: { clientId: string; code: string }): Promise<TokenPair>
  /** A new pair for the caller a refresh token names. */
  refresh(token: string | undefined): Promise<TokenPair>
  /** Revokes the caller's pair. Answers nothing; the route is a 204. */
  logout(subject: Subject | undefined): Promise<void>
  /** The body the browser sign-out answers once the host has reset its session. */
  logoutSession(): Promise<string>
  /** The caller, as `GET /SASjsApi/session` reports it. */
  session(subject: Subject | undefined): Promise<SessionResult>
}

const unauthorized = () => new ApiError(401, 'Unauthorized')

/**
 * The subject, provided the account behind it may still hold a token.
 *
 * `authenticate` reads a token on every request and refuses a deactivated
 * account; an exchange or a refresh that skipped the same check would mint a
 * fresh pair for exactly that account, so the check sits beside every path that
 * reaches `store.issue`.
 */
const liveSubject = async (
  store: IdentityStore,
  subject: Subject
): Promise<Subject> => {
  const user = await store.userById(subject.userId)
  if (!user || !user.isActive) throw unauthorized()

  return subject
}

export const createIdentityService = (
  store: IdentityStore
): IdentityService => ({
  async authenticate(token) {
    if (token === undefined) return undefined

    const subject = await store.readAccess(token)
    if (!subject) return undefined

    // A token names a user who may since have been deactivated. sasjs/server
    // checks `isActive` on every request, so a token that outlived the account
    // must stop resolving here too - otherwise the browser host honours a
    // caller the server would refuse.
    const user = await store.userById(subject.userId)
    return user && user.isActive ? subject : undefined
  },

  async login({ username, password }) {
    const user = await store.userByName(username)
    // An unknown username and a wrong password answer with different messages
    // on purpose: the server's login form tells the caller which one it was,
    // and the account lockout - the defence against guessing - is the host's.
    if (!user) throw new ApiError(401, 'Username is not found.')
    if (!(await store.passwordMatches(user, password)))
      throw new ApiError(401, 'Invalid Password.')
    // Checked after the password, so the answer is not a way to learn that an
    // account exists but is switched off without knowing its password.
    if (!user.isActive) throw new ApiError(401, 'This account is not active.')

    return {
      loggedIn: true,
      user: {
        uid: user.uid,
        username: user.username,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
        needsToUpdatePassword: user.needsToUpdatePassword
      }
    }
  },

  async authorize(subject, clientId) {
    // The same answer the server's middleware gives a caller with no token: the
    // two hosts must not describe the same refusal differently.
    if (!subject) throw unauthorized()
    if (!(await store.client(clientId)))
      throw new ApiError(403, 'Invalid clientId.')

    return store.issueCode({ userId: subject.userId, clientId })
  },

  async token({ clientId, code }) {
    // Read before claiming: a code presented with another client is refused
    // with the same answer as one that does not verify, and it is not spent, so
    // the caller can still exchange it for the client it was issued for.
    const subject = await store.readCode(code)
    if (!subject || subject.clientId !== clientId)
      throw new ApiError(401, 'Invalid Auth Code')

    // The client is read before the code is spent and before an existing pair is
    // handed back: both the pair and the tokens it would buy belong to the
    // client, so a client deleted since the code was issued refuses the
    // exchange - and refuses it without consuming the code.
    const client = await store.client(clientId)
    if (!client) throw new ApiError(401, 'Invalid clientId.')

    const named = await liveSubject(store, subject)

    if (!(await store.claimCode(code)))
      throw new ApiError(401, 'Invalid Auth Code')

    // Re-exchanging a code for the same user and client while a valid pair
    // exists returns that pair: another tab holding the old tokens must not be
    // signed out by a second exchange.
    const existing = await store.pairFor(named)
    if (existing) return existing

    const pair = await store.issue(named, client)
    await store.savePair(named, pair)
    return pair
  },

  async refresh(token) {
    const subject =
      token === undefined ? undefined : await store.readRefresh(token)
    if (!subject) throw unauthorized()

    const client = await store.client(subject.clientId)
    if (!client) throw new ApiError(401, 'Invalid clientId.')

    const named = await liveSubject(store, subject)

    const pair = await store.issue(named, client)
    await store.savePair(named, pair)
    return pair
  },

  async logout(subject) {
    if (!subject) throw unauthorized()

    await store.deletePair(subject)
  },

  async logoutSession() {
    return 'OK!'
  },

  async session(subject) {
    if (!subject) throw unauthorized()

    const user = await store.userById(subject.userId)
    if (!user) throw unauthorized()

    return asSession(user)
  }
})

/** A subject, as the session route reports it. */
export const asSession = (user: IdentityUser): SessionResult => ({
  uid: user.uid,
  username: user.username,
  displayName: user.displayName,
  isAdmin: user.isAdmin,
  needsToUpdatePassword: user.needsToUpdatePassword
})
