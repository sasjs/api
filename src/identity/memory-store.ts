/**
 * An `IdentityStore` over maps, for tests and for a host with no database.
 *
 * Tokens are opaque strings this store can look up, which is the shape the
 * browser build needs: no signing key, and nothing in the string a client can
 * read. A host with real credentials - a server - supplies its own store with
 * JWTs, bcrypt and a database behind it.
 */
import type {
  IdentityClient,
  IdentityStore,
  IdentityUser,
  Subject,
  TokenPair
} from './types.js'
import {
  DEFAULT_IDENTITY,
  IDENTITY_FORMAT,
  type IdentityFixture
} from './fixture.js'
import { ApiError } from '../types.js'

const keyOf = (subject: Subject) => `${subject.userId}|${subject.clientId}`

/**
 * Whether a token minted for one subject names the same user and client.
 *
 * The fixture can declare a token that outlives the map it is seeded into, so
 * the read paths compare rather than trust the reference.
 */
export class MemoryIdentityStore implements IdentityStore {
  private readonly users: IdentityUser[] = []
  private readonly passwords = new Map<string, string>()
  private readonly clients = new Map<string, IdentityClient>()
  private readonly pairs = new Map<string, TokenPair>()
  private readonly access = new Map<string, Subject>()
  private readonly refresh = new Map<string, Subject>()
  private readonly codes = new Map<string, Subject>()
  private readonly claimed = new Set<string>()
  private counter = 0

  constructor(fixture: IdentityFixture = DEFAULT_IDENTITY) {
    if (fixture.format !== IDENTITY_FORMAT)
      throw new ApiError(
        500,
        `The identity fixture states format ${String(fixture.format)}; this store reads ${IDENTITY_FORMAT}.`
      )

    for (const user of fixture.users) {
      this.users.push({
        uid: user.uid,
        username: user.username,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
        isActive: user.isActive,
        needsToUpdatePassword: user.needsToUpdatePassword
      })
      this.passwords.set(user.uid, user.password)
    }

    for (const client of fixture.clients)
      this.clients.set(client.clientId, {
        clientId: client.clientId,
        accessTokenExpiration: client.accessTokenExpiration,
        refreshTokenExpiration: client.refreshTokenExpiration
      })

    for (const token of fixture.tokens || []) {
      const user = this.users.find(
        (candidate) => candidate.username === token.username
      )
      if (!user) continue
      const subject: Subject = { userId: user.uid, clientId: token.clientId }
      if (token.accessToken) this.access.set(token.accessToken, subject)
      if (token.refreshToken) this.refresh.set(token.refreshToken, subject)
      // a seeded token is the subject's live pair, which is what makes it
      // authenticate: the read paths check the pair, not the token alone
      if (token.accessToken && token.refreshToken)
        this.pairs.set(keyOf(subject), {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken
        })
    }

    for (const code of fixture.codes || []) {
      const user = this.users.find(
        (candidate) => candidate.username === code.username
      )
      if (!user) continue
      this.codes.set(code.code, { userId: user.uid, clientId: code.clientId })
    }
  }

  async userByName(username: string): Promise<IdentityUser | undefined> {
    return this.users.find((user) => user.username === username)
  }

  async userById(uid: string): Promise<IdentityUser | undefined> {
    return this.users.find((user) => user.uid === uid)
  }

  /** A fixture holds the password in clear, so the check is an equality. */
  async passwordMatches(
    user: IdentityUser,
    password: string
  ): Promise<boolean> {
    return this.passwords.get(user.uid) === password
  }

  async client(clientId: string): Promise<IdentityClient | undefined> {
    return this.clients.get(clientId)
  }

  async issue(subject: Subject, client: IdentityClient): Promise<TokenPair> {
    this.counter += 1
    // The lifetimes are the client's, and the counter keeps two pairs issued in
    // the same millisecond distinct.
    const pair: TokenPair = {
      accessToken: `access-${this.counter}-${client.accessTokenExpiration}`,
      refreshToken: `refresh-${this.counter}-${client.refreshTokenExpiration}`
    }
    this.access.set(pair.accessToken, subject)
    this.refresh.set(pair.refreshToken, subject)
    return pair
  }

  /**
   * A token names its subject only while that subject's CURRENT pair holds it.
   * The server verifies a token against the pair saved for the user and client,
   * so a logged-out or rotated token stops working there too; without the same
   * check here, the browser host would honour a token the server had revoked.
   */
  async readAccess(token: string): Promise<Subject | undefined> {
    return this.current(token, this.access, 'accessToken')
  }

  async readRefresh(token: string): Promise<Subject | undefined> {
    return this.current(token, this.refresh, 'refreshToken')
  }

  private current(
    token: string,
    issued: Map<string, Subject>,
    kind: 'accessToken' | 'refreshToken'
  ): Subject | undefined {
    const subject = issued.get(token)
    if (!subject) return undefined

    const pair = this.pairs.get(keyOf(subject))
    return pair && pair[kind] === token ? subject : undefined
  }

  async pairFor(subject: Subject): Promise<TokenPair | undefined> {
    return this.pairs.get(keyOf(subject))
  }

  async savePair(subject: Subject, pair: TokenPair): Promise<void> {
    this.pairs.set(keyOf(subject), pair)
  }

  async deletePair(subject: Subject): Promise<void> {
    this.pairs.delete(keyOf(subject))
  }

  async issueCode(subject: Subject): Promise<string> {
    this.counter += 1
    const code = `code-${this.counter}`
    this.codes.set(code, subject)
    return code
  }

  async readCode(code: string): Promise<Subject | undefined> {
    return this.codes.get(code)
  }

  async claimCode(code: string): Promise<boolean> {
    if (this.claimed.has(code) || !this.codes.has(code)) return false
    this.claimed.add(code)
    return true
  }
}
