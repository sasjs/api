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
   * Removes the app published at `appLoc`.
   *
   * **The folder is the identity.** An app is one thing to deploy and one thing
   * to delete, and what it is called is a label on it: two apps can share a
   * folder only as a special case, and they are still one thing to load or
   * remove. So the lookup is by folder, and a name that no longer matches the
   * one recorded does not turn a correct deletion into a `404`.
   *
   * `false` when nothing is published at that folder, which the route reports as
   * a 404 - a delete that silently succeeded on a folder nobody deployed would
   * hide a caller's typo.
   */
  unpublish(appLoc: string): Promise<boolean>
}

export interface UnpublishBody {
  streamServiceName?: string
  appLoc?: string
}

/**
 * `DELETE /SASjsApi/drive/deploy`.
 *
 * The document requires both body values, so both are checked - a caller that
 * names a stream but not the folder has not said what to remove. Only the folder
 * reaches the registry, because that is what identifies the app.
 *
 * The checks are here rather than in the transport because this is the one
 * implementation of the operation: a host calling it directly gets the same
 * refusals in the same order, and with the same messages the document states.
 */
export const unpublishAppStream = async (
  registry: AppStreamRegistry,
  body: UnpublishBody | undefined
): Promise<{ status: 'success' }> => {
  if (!body?.streamServiceName)
    throw new ApiError(400, '"streamServiceName" is required')

  if (!body.appLoc) throw new ApiError(400, '"appLoc" is required')

  if (!(await registry.unpublish(body.appLoc)))
    throw new ApiError(404, 'No such app stream entry.')

  return { status: 'success' }
}

/**
 * The registry the corpus and the package's own tests read: one published app,
 * identified by its folder alone.
 */
export class MemoryAppStreamRegistry implements AppStreamRegistry {
  private readonly folders: Set<string>

  constructor(folders: string[] = ['/Public/myApp']) {
    this.folders = new Set(folders)
  }

  async unpublish(appLoc: string): Promise<boolean> {
    return this.folders.delete(appLoc)
  }
}
