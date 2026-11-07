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
   */
  lintConfig?: (filePath?: string) => LintConfig | undefined
}

export interface CodeService {
  /** The diagnostics for a buffer. Nothing is written and nothing is executed. */
  lint(caller: Subject | undefined, body: CodeRequest): Promise<Diagnostic[]>
  /** The formatted buffer. */
  format(caller: Subject | undefined, body: CodeRequest): Promise<string>
}

const STRING = (body: CodeRequest, field: string): string => {
  const value = body[field as keyof CodeRequest]
  if (typeof value !== 'string' || value === '')
    throw new ApiError(400, `"${field}" is required`)
  return value
}

/**
 * The two editor routes, over `@sasjs/lint`.
 *
 * The linter is a dependency because it is the same everywhere - the cli ships
 * it to browsers already - while the *rules* are the host's: which `.sasjslint`
 * applies to a path is a fact about a drive, so `lintConfig` is asked for it.
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

  const configFor = (filePath?: string) =>
    options.lintConfig ? options.lintConfig(filePath) : undefined

  return {
    async lint(caller, body) {
      requireCaller(caller)
      return lintText(STRING(body, 'code'), configFor(body.filePath))
    },

    async format(caller, body) {
      requireCaller(caller)
      return formatText(STRING(body, 'code'), configFor(body.filePath))
    }
  }
}
