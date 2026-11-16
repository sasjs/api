/**
 * The read a streamed deployment links to: one file out of the drive, by path.
 *
 * A build made with `streamWeb` rewrites every asset link in the entry page to
 * name the file it fetches - `?path=/Public/app/services/web/main.4f3a9c1d.js`,
 * the `_FILE=` spelling the estate answers - so the host has to read one file
 * back and hand it to a browser as itself. Serve it as bytes and the page
 * renders nothing: the difference between a working app and a blank one is the
 * Content-Type.
 *
 * So the typing, the caching and the refusal live here rather than in each
 * host, the same way the drive's own rules do: sasjs/server answers it at
 * `GET /SASjsApi/drive/file?_FILE=` (and under the estate's spelling), and the
 * browser build answers it from the drive a mock site already has.
 *
 * A file that is not there answers the way the estate answers - `202` with a
 * two-line message, not a `404`. A streamed app whose asset is missing has to
 * fail the same way in both places, or a fault reproduced locally is a
 * different fault from the one being chased.
 */
import { ApiError, isApiError } from '../types.js'
import type { DriveStore } from '../types.js'
import { cacheControlFor, contentTypeFor } from '../appstream/web.js'
import { checkFilePath, isRoot } from './paths.js'

/** What SAS Viya's job execution route answers for a file it cannot read. */
export const DEPLOYMENT_FILE_ERROR = 'Parameter Error\nFile error'

/**
 * One file, typed and ready to send.
 *
 * `body` is the file's bytes when there is a file, and the refusal's words when
 * there is not - a host sends whichever it got, with the status and type stated
 * here, so neither can quietly become the other.
 */
export interface DeploymentFilePage {
  status: number
  contentType: string
  /** Headers the host must set, chiefly the cache policy of an app's asset. */
  headers?: Record<string, string>
  body?: string | Uint8Array
}

export interface DeploymentFileService {
  /**
   * Reads one file for a streamed deployment. Refuses a path outside the drive
   * or one carrying a blocked extension with the drive's own `400`.
   */
  read(filePath: unknown): Promise<DeploymentFilePage>
}

/**
 * Whether a store refused because there is nothing at the path.
 *
 * Two spellings reach this code and both mean the same thing: the package's
 * stores throw `ApiError(404, "File doesn't exist.")`, and a host's store over a
 * filesystem (sasjs/server's) lets `fs` throw `ENOENT`. Anything else - a
 * permission failure, a broken link - is a real error and travels on.
 */
const notFound = (error: unknown): boolean =>
  (isApiError(error) && error.status === 404) ||
  // a structural read, not `NodeJS.ErrnoException`: this module is in the
  // browser build, which has no node types at all
  (error as { code?: unknown } | undefined)?.code === 'ENOENT'

/** The answer for a file that is not there, in the estate's words. */
const notThere = (): DeploymentFilePage => ({
  status: 202,
  contentType: 'text/plain; charset=utf-8',
  body: DEPLOYMENT_FILE_ERROR
})

export const createDeploymentFileService = (
  store: DriveStore
): DeploymentFileService => ({
  async read(input: unknown): Promise<DeploymentFilePage> {
    // the drive's containment and extension rules decide first: a streamed page
    // is caller-supplied content, and this read must not be a way round them
    const checked = checkFilePath(input)

    if ('reason' in checked)
      throw checked.reason === 'extension'
        ? new ApiError(400, 'Invalid file extension')
        : new ApiError(400, `Can't get file outside drive.`)

    if (isRoot(checked.path))
      throw new ApiError(400, `Can't get file outside drive.`)

    const path = checked.path

    // The stat and the read are one attempt, not a check followed by an action:
    // a file can be removed or replaced between them, and the fault this route
    // exists to reproduce is a missing asset - which has to answer `202` in the
    // estate's words, not whatever the store threw at that instant. A folder is
    // refused the same way: there is no file to send.
    try {
      if ((await store.stat(path)).directory) return notThere()

      return {
        status: 200,
        contentType: contentTypeFor(path),
        // lower case, matching the app stream's own answer (src/appstream/web.ts):
        // the names are case-insensitive in HTTP but not in a plain object, and a
        // host copying one into the other would lose a policy that mattered
        headers: { 'cache-control': cacheControlFor(path) },
        body: await store.read(path)
      }
    } catch (error) {
      if (notFound(error)) return notThere()

      throw error
    }
  }
})
