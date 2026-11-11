/**
 * What a capture may contain, and what it must never contain.
 *
 * A capture is meant to be sent to somebody else and committed as a corpus, so
 * two kinds of fact have to leave it before it leaves the machine: the
 * credentials the requests carry, and anything that names the environment they
 * came from - the estate's host in a link, an address in an error message, an
 * identifier a reader could act on.
 *
 * The scrubber replaces what it knows by name and by literal. The verifier is
 * the second opinion: it reads the finished capture and reports which category of
 * leak is still present, so a missed branch fails loudly instead of travelling.
 */

export const REDACTED = '<redacted>'
export const ESTATE = '<estate>'

const SECRET_KEYS = [
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'id_token',
  'idtoken',
  'client_secret',
  'clientsecret',
  'secret',
  'password',
  'passwd',
  'authorization',
  'cookie',
  'csrftoken',
  'x-csrf-token',
  'x-xsrf-token',
  'code'
]

const SECRET_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-xsrf-token'
]

const normalise = (key) =>
  String(key)
    .toLowerCase()
    .replace(/[\s_-]/g, '')

/** Whether a parameter name carries a credential. */
export const isSecretKey = (key) =>
  SECRET_KEYS.map(normalise).includes(normalise(key))

/** Whether a header carries a credential or a session. */
export const isSecretHeader = (header) =>
  SECRET_HEADERS.includes(String(header).toLowerCase())

/**
 * A scrubber for one run: the environment's names and the run's secrets.
 *
 * Order matters. The origin goes before the host so a link keeps its shape
 * (`https://<estate>/path`), and the longest secrets go before the shortest so a
 * secret that contains another secret is not half-replaced.
 */
export const createScrubber = ({
  origin = '',
  host = '',
  secrets = []
} = {}) => {
  // places and secrets are separate lists: a place becomes a placeholder a
  // reader can still see the shape of, a secret becomes a marker that says
  // nothing. Longest first in both, so a value that contains another is not
  // half-replaced.
  const places = [origin, host]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  const values = secrets
    .filter((secret) => secret && secret.length > 3)
    .sort((a, b) => b.length - a.length)

  return (text) => {
    let out = String(text ?? '')

    for (const place of places)
      out = out
        .split(place)
        .join(place === origin ? `https://${ESTATE}` : ESTATE)

    for (const value of values) out = out.split(value).join(REDACTED)

    return out
  }
}

/** An `Authorization` value with its scheme kept and its credential removed. */
export const redactAuthorization = (value) => {
  const scheme = /^(basic|bearer|negotiate|digest)\b/i.exec(String(value))?.[0]

  return scheme ? `${scheme} ${REDACTED}` : REDACTED
}

/** Request or response headers, with the credential-bearing ones redacted. */
export const redactHeaders = (headers = {}) =>
  Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      isSecretHeader(key) ? redactAuthorization(value) : value
    ])
  )

/**
 * A body, with the values that carry a credential replaced and the environment
 * scrubbed out.
 *
 * JSON is walked by key, so a token in a response body is replaced wherever it
 * sits. A form-encoded body is redacted by parameter name. Anything else - an
 * HTML login page, a SAS log - is only scrubbed for the literals this run knows,
 * because rewriting arbitrary text by pattern would corrupt the thing being
 * documented.
 */
export const redactBody = (
  text,
  contentType = '',
  scrub = (value) => value
) => {
  if (!text) return text

  const trimmed = String(text).trim()
  const type = String(contentType).toLowerCase()
  const looksJson = type.includes('json') || /^[[{]/.test(trimmed)

  if (looksJson) {
    try {
      const walk = (value) => {
        if (Array.isArray(value)) return value.map(walk)

        if (value && typeof value === 'object')
          return Object.fromEntries(
            Object.entries(value).map(([key, inner]) => [
              key,
              isSecretKey(key) ? REDACTED : walk(inner)
            ])
          )

        return value
      }

      return scrub(JSON.stringify(walk(JSON.parse(trimmed))))
    } catch {
      return scrub(text)
    }
  }

  if (type.includes('x-www-form-urlencoded'))
    return scrub(
      trimmed.replace(
        /(^|&)([^=&]+)=([^&]*)/g,
        (match, separator, key) =>
          `${separator}${key}=${isSecretKey(key) ? REDACTED : '<value>'}`
      )
    )

  return scrub(text)
}

const JWT = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/
const IPV4 = /\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)\d{1,3}(?:\.\d{1,3}){3}\b/

/**
 * What is still sensitive in a finished capture.
 *
 * Categories only, and counts only: printing the offending text would defeat the
 * purpose, and printing its position would tell a reader where to look in a file
 * that is about to be deleted.
 */
export const findLeaks = (text, { host = '', secrets = [] } = {}) => {
  const body = String(text ?? '')
  const found = []

  const count = (pattern) => (body.match(pattern) ?? []).length

  if (host && body.includes(host))
    found.push({ category: 'estate-host', count: 1 })

  const secretHits = secrets.filter(
    (secret) => secret && secret.length > 3 && body.includes(secret)
  ).length

  if (secretHits) found.push({ category: 'credential', count: secretHits })

  const jwt = count(JWT)
  if (jwt) found.push({ category: 'token-shaped-value', count: jwt })

  const addresses = count(IPV4)
  if (addresses) found.push({ category: 'address', count: addresses })

  return found
}
