/**
 * An `IdentityStore` over maps, for tests and for a host with no database.
 *
 * Tokens are opaque strings this store can look up, which is the shape the
 * browser build needs: no signing key, and nothing in the string a client can
 * read. They are minted from the platform's cryptographic source and carry the
 * client's lifetime, so a guessed string buys nothing and an old one stops
 * resolving. A host with real credentials - a server - supplies its own store
 * with JWTs, bcrypt and a database behind it.
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

/** The Web Crypto surface this store needs, on a global a worker also has. */
interface RandomSource {
  getRandomValues(array: Uint8Array): Uint8Array
}

/**
 * Opaque identity strings, from the platform's cryptographic source.
 *
 * These strings are credentials: whoever holds one is the caller it names. A
 * counter or `Math.random` is a sequence a reader can reproduce, so it would
 * let one caller name another - the store is small and demo-shaped, but a token
 * that can be guessed is not a demo quirk, it is an authentication bypass.
 *
 * `globalThis.crypto` is present in every browser and in Node from 19, which is
 * the same reach the rest of this package has (no node imports, so the browser
 * build bundles it unchanged).
 */
const randomHex = (bytes: number): string => {
  const source = (globalThis as unknown as { crypto?: RandomSource }).crypto
  if (!source)
    throw new ApiError(
      500,
      'This host has no Web Crypto (`globalThis.crypto`), so it cannot mint an unguessable identity string.'
    )

  const buffer = new Uint8Array(bytes)
  source.getRandomValues(buffer)
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}

/**
 * How long a code buys tokens, in seconds.
 *
 * The same lifetime `sasjs/server` signs into its auth code JWT, so a code a
 * mock issues and one a server issues age out together.
 */
const CODE_LIFETIME_SECONDS = 30

/** A string this store mints, and the instant it stops naming its subject. */
interface Issued {
  subject: Subject
  /** Milliseconds since the epoch. Absent for a seeded string, which never expires. */
  expiresAt?: number
}

const live = (issued: Issued | undefined, now: number): Subject | undefined =>
  issued && (issued.expiresAt === undefined || issued.expiresAt > now)
    ? issued.subject
    : undefined

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
  private readonly access = new Map<string, Issued>()
  private readonly refresh = new Map<string, Issued>()
  private readonly codes = new Map<string, Issued>()
  private readonly claimed = new Set<string>()

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
      if (token.accessToken) this.access.set(token.accessToken, { subject })
      if (token.refreshToken) this.refresh.set(token.refreshToken, { subject })
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
      this.codes.set(code.code, {
        subject: { userId: user.uid, clientId: code.clientId }
      })
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
    // The lifetimes are the client's, recorded against the instant of issue: a
    // token's expiry is a fact about this pair, so the read paths can answer
    // "invalid or expired" rather than carrying a number nothing compares.
    const issuedAt = Date.now()
    const pair: TokenPair = {
      accessToken: `access-${randomHex(16)}`,
      refreshToken: `refresh-${randomHex(16)}`
    }
    this.access.set(pair.accessToken, {
      subject,
      expiresAt: issuedAt + client.accessTokenExpiration * 1000
    })
    this.refresh.set(pair.refreshToken, {
      subject,
      expiresAt: issuedAt + client.refreshTokenExpiration * 1000
    })
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
    issued: Map<string, Issued>,
    kind: 'accessToken' | 'refreshToken'
  ): Subject | undefined {
    const entry = issued.get(token)
    if (!entry) return undefined

    const subject = live(entry, Date.now())
    if (!subject) return undefined

    const pair = this.pairs.get(keyOf(subject))
    return pair && pair[kind] === token ? subject : undefined
  }

  /**
   * The subject's saved pair, while both of its tokens are still live.
   *
   * An exchange hands a saved pair back rather than rotating a second tab's
   * tokens. That is only an answer if the pair can still be used: a saved pair
   * whose access token has aged out would sign the caller in and then refuse
   * every request it makes, so an aged-out pair is reported as absent and the
   * exchange mints a fresh one. `live()` reads the issue-time expiry, which a
   * seeded token does not carry - a seeded pair therefore never ages out here.
   */
  async pairFor(subject: Subject): Promise<TokenPair | undefined> {
    const pair = this.pairs.get(keyOf(subject))
    if (!pair) return undefined

    const now = Date.now()
    const access = this.access.get(pair.accessToken)
    const refresh = this.refresh.get(pair.refreshToken)

    return live(access, now) && live(refresh, now) ? pair : undefined
  }

  async savePair(subject: Subject, pair: TokenPair): Promise<void> {
    this.pairs.set(keyOf(subject), pair)
  }

  async deletePair(subject: Subject): Promise<void> {
    this.pairs.delete(keyOf(subject))
  }

  async issueCode(subject: Subject): Promise<string> {
    const code = `code-${randomHex(16)}`
    this.codes.set(code, {
      subject,
      expiresAt: Date.now() + CODE_LIFETIME_SECONDS * 1000
    })
    return code
  }

  async readCode(code: string): Promise<Subject | undefined> {
    return live(this.codes.get(code), Date.now())
  }

  async claimCode(code: string): Promise<boolean> {
    if (this.claimed.has(code) || !this.codes.has(code)) return false
    this.claimed.add(code)
    return true
  }
}
