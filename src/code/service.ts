import { formatText, lintText } from '@sasjs/lint'
import type { Diagnostic, LintConfig } from '@sasjs/lint'

import { ApiError } from '../types.js'
import type { Subject } from '../identity/types.js'

/** What both code routes take: a buffer, and where it came from when it has a file. */
export interface CodeRequest {
  code: string
  /** The drive path the code belongs to, so a host can pick that folder's rules. */
  filePath?: string
}

export interface CodeServiceOptions {
  /**
   * The lint configuration that applies to a file.
   *
   * A host resolves the nearest `.sasjslint` at or above `filePath`, so each
   * folder can carry its own rules; without one the linter's defaults apply,
   * which is what an untitled buffer lints against.
   *
   * It may answer with a promise. A host whose rules are files in a store it
   * reads asynchronously - the browser host over its drive - holds no
   * synchronous copy to hand back, and reading the rules per request is the
   * point of the option rather than an overhead to cache around. A host with
   * the configuration already in hand returns it directly, which the routes
   * await either way.
   */
  lintConfig?: (
    filePath?: string
  ) => LintConfig | undefined | Promise<LintConfig | undefined>
}

export interface CodeService {
  /** The diagnostics for a buffer. Nothing is written and nothing is executed. */
  lint(caller: Subject | undefined, body: CodeRequest): Promise<Diagnostic[]>
  /** The formatted buffer. */
  format(caller: Subject | undefined, body: CodeRequest): Promise<string>
}

/**
 * `code`, refused the way the server's schema refuses it.
 *
 * Coercing with `String(...)` defeated the refusal: `{"code": 123}` was linted as
 * the text "123" and `{"code": ""}` answered "required" where the server says it
 * is empty. The three messages are Joi's, because they are the ones a client
 * written against the document already handles.
 */
const codeOf = (body: CodeRequest): string => {
  const value = (body as unknown as Record<string, unknown>).code
  if (value === undefined) throw new ApiError(400, '"code" is required')
  if (typeof value !== 'string')
    throw new ApiError(400, '"code" must be a string')
  if (value === '') throw new ApiError(400, '"code" is not allowed to be empty')
  return value
}

/**
 * The two editor routes, over `@sasjs/lint`.
 *
 * The linter is a dependency because it is the same everywhere, and it is
 * deliberately NOT reachable from the package root: `@sasjs/lint` resolves its
 * configuration by walking the filesystem, so it cannot be bundled into the
 * service worker the browser entry produces. A host that wants these routes
 * imports `@sasjs/api/code`, which is Node-only, exactly like the linter.
 *
 * The *rules* are the host's: which `.sasjslint` applies to a path is a fact
 * about a drive, so `lintConfig` is asked for it.
 * Neither route touches the drive or runs anything; they answer about the text
 * in the request, which is what lets an editor check unsaved changes.
 */
export const createCodeService = (
  options: CodeServiceOptions = {}
): CodeService => {
  const requireCaller = (caller: Subject | undefined) => {
    // both routes are permissioned at the gate, so a caller that reached the
    // service without one is a host that skipped it rather than a public route
    if (!caller) throw new ApiError(401, 'Unauthorized')
  }

  const configFor = async (filePath?: string) =>
    options.lintConfig ? await options.lintConfig(filePath) : undefined

  return {
    async lint(caller, body) {
      requireCaller(caller)
      return lintText(codeOf(body), await configFor(body.filePath))
    },

    async format(caller, body) {
      requireCaller(caller)
      return formatText(codeOf(body), await configFor(body.filePath))
    }
  }
}
