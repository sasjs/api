/**
 * Finding the program a request names, once, for every host.
 *
 * `_program` is a path the caller chose, so two things have to be decided the same
 * way in every host that runs one: that the path stays inside the drive, and which
 * file and run time it actually names. The first is the host's - only it knows where
 * its drive starts - and the second is this module's, because "try the extension the
 * name states, otherwise `<path>.<runTime>` for each runtime in turn, otherwise the
 * program does not exist" is the API's rule and not a host's preference.
 *
 * The host supplies three things: how to resolve a caller's path against its drive
 * (answering `null` for a path that leaves it), whether a resolved path exists, and
 * the run times it can offer. The extension vocabulary is not one of them - that is
 * the document's, and `runTimeOfPath` reads it here. Nothing here touches a filesystem, a drive or a clock,
 * so the browser host can answer with the same function over its own store.
 */
import { ApiError } from '../types.js'
import { DOCUMENTED_RUN_TIMES } from './runTimes.js'

/** The program the request named, and the run time its own name states. */
export interface ProgramResolution {
  /** Where the program is, in the host's own addressing. */
  path: string

  /** The run time the extension names, when it names one. */
  runTime?: string
}

export interface ProgramDeps {
  /**
   * The caller's path resolved against the host's drive, or `null` when it leaves it.
   *
   * A path that leaves the drive is refused the way a program that is not there is
   * refused: saying "your path was rejected but existed" would say something about
   * the host's filesystem.
   */
  resolve: (given: string) => string | null

  /** Whether the host holds a file at that path. */
  exists: (path: string) => Promise<boolean>

  /** The run times this host can offer, in the order it probes for one. */
  runTimes: string[]
}

/**
 * The detail a refusal carries, naming the path the caller gave.
 *
 * Exported because the runtime service renders the same condition the same way, and
 * two copies of the sentence is how the two drift: the service's envelope states it as
 * `error`, and this module states it as the message a host sends when it does not
 * render an envelope at all.
 */
export const programNotFound = (given: string): string =>
  `The Program at (${given}) does not exist.`

/** The refusal, as this module decides it: the status and that detail. */
const notThere = (given: string) => new ApiError(400, programNotFound(given))

/**
 * The run time a path's own name states, if it states one.
 *
 * The vocabulary is the document's (`DOCUMENTED_RUN_TIMES`), not a host's: a host
 * that cannot run Python still reads `run.py` as Python and answers separately that
 * it has no such run time. `run.sas7bdat` and `run.backup` name none, and are then
 * probed like a path with no extension at all - which is what the server has always
 * done.
 *
 * The extension is read below either separator, because the server runs on Windows
 * too and resolves its paths with backslashes.
 */
export const runTimeOfPath = (path: string): string | undefined => {
  const file = path.split(/[\\/]/).pop() || ''
  const dot = file.lastIndexOf('.')

  // a leading dot names no extension: `.sas` is a file, not a suffix
  const extension = dot > 0 ? file.slice(dot + 1).toLowerCase() : ''

  return DOCUMENTED_RUN_TIMES.includes(extension) ? extension : undefined
}

/**
 * The program and run time a request's `_program` names.
 *
 * The refusal is decided here - `400`, and the detail that names the path the caller
 * gave - and *rendered* by whoever called this, because that is where the two hosts
 * already differ: this package's runtime routes wrap it in the failed-run envelope
 * (`{ status, message, error }`, pinned in `spec/runtime.spec.ts`), and a host that
 * sends the message as text keeps sending it as text. Deciding the rendering here
 * would change one host's answer on the way to unifying the rule, which is not what
 * the seam is for.
 */
export const resolveProgram = async (
  given: string,
  deps: ProgramDeps
): Promise<ProgramResolution> => {
  const resolved = deps.resolve(given)

  if (resolved === null) throw notThere(given)

  const extension = runTimeOfPath(resolved)

  if (extension !== undefined) {
    // the name states its run time: no probing, and a file that is not there is
    // refused even if `<path>.sas` happens to exist
    if (await deps.exists(resolved))
      return { path: resolved, runTime: extension }
  } else {
    for (const runTime of deps.runTimes) {
      const candidate = `${resolved}.${runTime}`

      if (await deps.exists(candidate)) return { path: candidate, runTime }
    }
  }

  throw notThere(given)
}
