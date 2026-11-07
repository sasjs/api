import { ApiError } from '../types.js'

/**
 * The app streams a host has published, as the API needs to unpublish one.
 *
 * A published stream is the host's own record - a directory convention, a
 * registry table, whatever it uses to know that `/Public/myApp` is served at
 * `/Public/myApp/index.html`. The package cannot invent it, so the route takes
 * this port and answers 501 without it, the same way the session routes do.
 */
export interface AppStreamRegistry {
  /**
   * Removes the entry for `appLoc` served by `streamServiceName`.
   *
   * `false` when there was nothing to remove, which the route reports as a 404 -
   * a delete that silently succeeds on a name nobody published would hide a
   * caller's typo.
   */
  unpublish(streamServiceName: string, appLoc: string): Promise<boolean>
}

export interface UnpublishBody {
  streamServiceName?: string
  appLoc?: string
}

/**
 * `DELETE /SASjsApi/drive/deploy`.
 *
 * The checks are here rather than in the transport because this is the one
 * implementation of the operation: a host calling it directly gets the same
 * refusals as a request to the route, in the same order, and with the same
 * messages the document states.
 */
export const unpublishAppStream = async (
  registry: AppStreamRegistry,
  body: UnpublishBody | undefined
): Promise<{ status: 'success' }> => {
  if (!body?.streamServiceName)
    throw new ApiError(400, '"streamServiceName" is required')

  if (!body.appLoc) throw new ApiError(400, '"appLoc" is required')

  if (!(await registry.unpublish(body.streamServiceName, body.appLoc)))
    throw new ApiError(404, 'No such app stream entry.')

  return { status: 'success' }
}

/**
 * The registry the corpus and the package's own tests read: one published
 * stream, keyed by both of the values a caller has to supply, so a case can be
 * wrong in either of them and be refused.
 */
export class MemoryAppStreamRegistry implements AppStreamRegistry {
  private readonly entries: Map<string, string>

  constructor(entries: Record<string, string> = { myApp: '/Public/myApp' }) {
    this.entries = new Map(Object.entries(entries))
  }

  async unpublish(streamServiceName: string, appLoc: string): Promise<boolean> {
    if (this.entries.get(streamServiceName) !== appLoc) return false

    this.entries.delete(streamServiceName)
    return true
  }
}
