/**
 * Drive path rules, in one place.
 *
 * These are the server's rules, not an invention of this package:
 * `resolveWithinDrive` in sasjs/server resolves a caller-supplied path against
 * the drive root and refuses anything that leaves it, and `filePathSchema`
 * refuses a handful of extensions before a path reaches the drive at all.
 * Because both hosts now import this file, the rule can only be changed in one
 * place - which is the point of the package.
 */

/**
 * Extensions a drive request may not name, on any route (the server's
 * `blockFileRegex`). Nothing is executable on a browser host, but a client that
 * would be refused by a server should hear the same answer from the mock.
 */
const BLOCKED_EXTENSION = /\.(exe|sh|htaccess)$/i

/** True when the last segment of the path carries a refused extension. */
export const hasBlockedExtension = (path: string): boolean =>
  BLOCKED_EXTENSION.test(path)

/**
 * A caller-supplied path as a drive-relative path, or `null` when it would land
 * outside the drive.
 *
 * The rules, each of which a test pins:
 *
 *   - a leading slash means "under the drive root", never filesystem-absolute -
 *     so `/Public/app/x` and `Public/app/x` are the same destination;
 *   - a backslash is a separator, because a Windows client sends them;
 *   - `.` is ignored and `..` pops a segment, so traversal is resolved rather
 *     than string-matched;
 *   - a `..` that would pop past the root returns null instead of clamping,
 *     because a path that escapes is refused, not rewritten;
 *   - a name that merely starts with dots (`..foo`) is a name, not a traversal.
 *
 * The return value starts with '/' (the root is '/'), has no trailing slash.
 */
export const normaliseDrivePath = (input: unknown): string | null => {
  const given = typeof input === 'string' ? input : ''
  const segments: string[] = []

  for (const segment of given.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!segments.length) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  return '/' + segments.join('/')
}

/** The folder a file path sits in ('/' for a path at the root). */
export const dirname = (path: string): string => {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}

/** The last segment of a path. */
export const basename = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1)

/** The drive root itself, which no write may name. */
export const isRoot = (path: string): boolean => path === '/'

/**
 * The path a file request names, with the blocked-extension rule applied.
 * Returns the reason rather than a status, so the caller chooses the wording:
 * a traversal and an extension are both 400s, with different messages.
 */
export const checkFilePath = (
  input: unknown
): { path: string } | { reason: 'outside' } | { reason: 'extension' } => {
  const path = normaliseDrivePath(input)
  if (path === null) return { reason: 'outside' }
  if (hasBlockedExtension(path)) return { reason: 'extension' }
  return { path }
}
