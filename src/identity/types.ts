/**
 * The identity the API works over, as a host supplies it.
 *
 * A server holds users in a database, verifies a bcrypt hash and signs JWTs; a
 * browser build holds a seeded fixture, compares a plain-text demo password and
 * mints opaque strings. Those differences are the host's, so they live behind
 * this port - the statuses, the messages and the order of the checks are the
 * service's, and both hosts run the same corpus over them.
 */

/** The caller a token names: a user, and the client the token was issued for. */
export interface Subject {
  userId: string
  clientId: string
}

export interface IdentityUser {
  uid: string
  username: string
  displayName: string
  isAdmin: boolean
  isActive: boolean
  needsToUpdatePassword: boolean
}

export interface IdentityClient {
  clientId: string
  /** Seconds an access token lives, as the client is configured. */
  accessTokenExpiration: number
  /** Seconds a refresh token lives. */
  refreshTokenExpiration: number
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

/**
 * Users, clients, token pairs and auth codes, plus the cryptography that names
 * a subject in a token.
 *
 * Minting and reading a token sit here rather than on a separate codec because
 * they are one decision: a host that signs JWTs also verifies them against the
 * same secret, and a host with no signing key issues opaque strings it can look
 * up. Splitting them would let a host pair one host's minting with another's
 * verification, which is never what anyone means.
 */
export interface IdentityStore {
  userByName(username: string): Promise<IdentityUser | undefined>
  userById(uid: string): Promise<IdentityUser | undefined>
  /**
   * Whether the password matches. The host owns the check: a bcrypt hash, a
   * directory bind, or a fixture's declared demo password.
   */
  passwordMatches(user: IdentityUser, password: string): Promise<boolean>
  client(clientId: string): Promise<IdentityClient | undefined>
  /** A pair for the subject, with the client's own lifetimes. */
  issue(subject: Subject, client: IdentityClient): Promise<TokenPair>
  /** The subject an access token names, or undefined when it is invalid or expired. */
  readAccess(token: string): Promise<Subject | undefined>
  /** The same for a refresh token. A host may keep them in separate stores. */
  readRefresh(token: string): Promise<Subject | undefined>
  /** The pair currently held for the subject, if the host keeps one. */
  pairFor(subject: Subject): Promise<TokenPair | undefined>
  savePair(subject: Subject, pair: TokenPair): Promise<void>
  deletePair(subject: Subject): Promise<void>
  /** A single-use authorization code naming the subject. */
  issueCode(subject: Subject): Promise<string>
  /**
   * The subject a code names, without consuming it: authentic and unexpired,
   * or undefined. Read first, so a code presented with the wrong client id is
   * refused without being spent - the caller may still exchange it for the
   * client it was issued for.
   */
  readCode(code: string): Promise<Subject | undefined>
  /**
   * Spends a code, answering whether this call was the one that did. The first
   * call answers true; every later call for the same string answers false,
   * which is what makes an exchange single-use even when two requests race.
   */
  claimCode(code: string): Promise<boolean>
}
