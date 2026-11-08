/**
 * The three Admin reports: this host's own process, memory, disk and logs.
 *
 * The values are the host's - a pid, a folder walk, the tail of a file - and a
 * browser build has no equivalent, so the reports are supplied through a port.
 * What this file owns is everything a client keys on:
 *
 *   - the body's shape, because a diagnostics page that reads
 *     `memory.rssBytes` renders `NaN` when a host omits it, and a report that is
 *     missing a field is a host bug rather than an empty reading;
 *   - the log file name rule: a bare name ending in `.log`, refused with `400`
 *     for anything that could resolve outside the log folder (`..`, a
 *     separator, an absolute path). The host resolves the name inside its own
 *     folder - this is the same rule sasjs/server applies before it touches the
 *     filesystem, and doing it here means both hosts refuse a traversal the same
 *     way;
 *   - `404` for a name that is not there, `200` with a bounded tail otherwise,
 *     and the line count clamped to the documented default and maximum so a
 *     caller cannot ask a host to read a gigabyte.
 *
 * `GET /admin/diagnostics`, `GET /admin/logs` and `GET /admin/logs/{fileName}`
 * are mounted behind the host's own administrator middleware (sasjs/server puts
 * `authenticateAccessToken` and `verifyAdmin` in front of all three), so the
 * caller's right to read these is the host's decision and is marked
 * `hostResponses` in the overlay.
 */
import { ApiError } from '../types.js'

/** What produced the build, from the host's build stamp. */
export interface BuildInfo {
  version: string
  gitHash: string
  buildDate: string | null
}

export interface ServerDetails {
  mode: string
  uptimeSeconds: number
  startedAt: string
  pid: number
  nodeVersion: string
  platform: string
  arch: string
  cpuCount: number
  cpuModel: string
  loadAverage: number[]
  runTimes: string[]
  sasjsRoot: string
}

export interface MemoryDetails {
  rssBytes: number
  heapTotalBytes: number
  heapUsedBytes: number
  externalBytes: number
  systemTotalBytes: number
  systemFreeBytes: number
}

export interface FilesystemUsage {
  path: string
  totalBytes: number
  freeBytes: number
  usedBytes: number
  usedPercent: number
}

export interface FolderUsage {
  label: string
  path: string
  exists: boolean
  bytes: number
  files: number
  truncated: boolean
}

export interface LogFolderSummary {
  folder: string
  fileCount: number
  totalBytes: number
  newestFile: string | null
  newestModified: string | null
}

export interface DiagnosticsResponse {
  build: BuildInfo
  server: ServerDetails
  memory: MemoryDetails
  /** `null` when the filesystem holding the root cannot be read. */
  filesystem: FilesystemUsage | null
  folders: FolderUsage[]
  logs: LogFolderSummary
}

export interface LogFileInfo {
  name: string
  sizeBytes: number
  modified: string
}

export interface LogTail {
  fileName: string
  lines: number
  bytesRead: number
  truncated: boolean
  content: string
}

/** The host's own reports. Absent a report, the route answers 501. */
export interface AdminReports {
  diagnostics(): Promise<DiagnosticsResponse>
  /** The access logs this host has written, newest first. */
  logs(): Promise<LogFileInfo[]>
  /** The tail of one log file, or `undefined` when the folder has no such file. */
  logTail(fileName: string, lines: number): Promise<LogTail | undefined>
}

export interface AdminService {
  diagnostics(): Promise<DiagnosticsResponse>
  logs(): Promise<LogFileInfo[]>
  logTail(fileName: string, lines?: number): Promise<LogTail>
}

/** The documented defaults on the route's `lines` parameter. */
export const DEFAULT_LOG_LINES = 200
export const MAX_LOG_LINES = 5000

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isString = (value: unknown): value is string => typeof value === 'string'

const requireString = (
  holder: Record<string, unknown>,
  key: string,
  where: string
): void => {
  if (!isString(holder[key]))
    throw new Error(
      `The ${where} report states \`${key}\` as ${JSON.stringify(holder[key])}; the document states a string, and a client that renders it would print the value as it stands.`
    )
}

const requireNumber = (
  holder: Record<string, unknown>,
  key: string,
  where: string
): void => {
  if (!isNumber(holder[key]))
    throw new Error(
      `The ${where} report states \`${key}\` as ${JSON.stringify(holder[key])}; the document states a number, and a client that renders it would print NaN.`
    )
}

const requireObject = (
  holder: Record<string, unknown>,
  key: string,
  where: string
): Record<string, unknown> => {
  const value = holder[key]
  if (!isObject(value))
    throw new Error(
      `The ${where} report states \`${key}\` as ${JSON.stringify(value)}; the document states an object.`
    )
  return value
}

/**
 * The diagnostics body, checked field by field.
 *
 * A host that cannot read its filesystem states `filesystem: null`, which the
 * document allows; a host that cannot read anything at all should refuse the
 * request itself, because an empty object here renders as a page of zeroes.
 */
export const normaliseDiagnostics = (
  report: DiagnosticsResponse
): DiagnosticsResponse => {
  if (!isObject(report))
    throw new Error('The diagnostics report is not an object.')

  const build = requireObject(
    report as unknown as Record<string, unknown>,
    'build',
    'diagnostics'
  )
  requireString(build, 'version', 'diagnostics build')
  requireString(build, 'gitHash', 'diagnostics build')
  if (!(build.buildDate === null || isString(build.buildDate)))
    throw new Error(
      `The diagnostics build states \`buildDate\` as ${JSON.stringify(build.buildDate)}; the document states an ISO timestamp or null.`
    )

  const server = requireObject(
    report as unknown as Record<string, unknown>,
    'server',
    'diagnostics'
  )
  requireString(server, 'mode', 'diagnostics server')
  requireString(server, 'startedAt', 'diagnostics server')
  requireString(server, 'nodeVersion', 'diagnostics server')
  requireString(server, 'platform', 'diagnostics server')
  requireString(server, 'arch', 'diagnostics server')
  requireString(server, 'cpuModel', 'diagnostics server')
  requireString(server, 'sasjsRoot', 'diagnostics server')
  requireNumber(server, 'uptimeSeconds', 'diagnostics server')
  requireNumber(server, 'pid', 'diagnostics server')
  requireNumber(server, 'cpuCount', 'diagnostics server')
  if (!Array.isArray(server.loadAverage) || !server.loadAverage.every(isNumber))
    throw new Error(
      'The diagnostics server report states `loadAverage` as something other than an array of numbers.'
    )
  if (!Array.isArray(server.runTimes) || !server.runTimes.every(isString))
    throw new Error(
      'The diagnostics server report states `runTimes` as something other than an array of strings.'
    )

  const memory = requireObject(
    report as unknown as Record<string, unknown>,
    'memory',
    'diagnostics'
  )
  for (const key of [
    'rssBytes',
    'heapTotalBytes',
    'heapUsedBytes',
    'externalBytes',
    'systemTotalBytes',
    'systemFreeBytes'
  ])
    requireNumber(memory, key, 'diagnostics memory')

  const filesystem = report.filesystem
  if (filesystem !== null) {
    if (!isObject(filesystem))
      throw new Error(
        `The diagnostics report states \`filesystem\` as ${JSON.stringify(filesystem)}; the document states an object or null.`
      )
    requireString(
      filesystem as Record<string, unknown>,
      'path',
      'diagnostics filesystem'
    )
    for (const key of ['totalBytes', 'freeBytes', 'usedBytes', 'usedPercent'])
      requireNumber(
        filesystem as Record<string, unknown>,
        key,
        'diagnostics filesystem'
      )
  }

  if (!Array.isArray(report.folders))
    throw new Error(
      'The diagnostics report states `folders` as something other than an array.'
    )
  for (const folder of report.folders) {
    if (!isObject(folder))
      throw new Error(
        'The diagnostics report carries a folder that is not an object.'
      )
    const entry = folder as Record<string, unknown>
    requireString(entry, 'label', 'diagnostics folder')
    requireString(entry, 'path', 'diagnostics folder')
    requireNumber(entry, 'bytes', 'diagnostics folder')
    requireNumber(entry, 'files', 'diagnostics folder')
    if (
      typeof entry.exists !== 'boolean' ||
      typeof entry.truncated !== 'boolean'
    )
      throw new Error(
        'The diagnostics folder report states `exists` or `truncated` as something other than a boolean.'
      )
  }

  const logs = requireObject(
    report as unknown as Record<string, unknown>,
    'logs',
    'diagnostics'
  )
  requireString(logs, 'folder', 'diagnostics logs')
  requireNumber(logs, 'fileCount', 'diagnostics logs')
  requireNumber(logs, 'totalBytes', 'diagnostics logs')
  for (const key of ['newestFile', 'newestModified'])
    if (!(logs[key] === null || isString(logs[key])))
      throw new Error(
        `The diagnostics logs summary states \`${key}\` as ${JSON.stringify(logs[key])}; the document states a string or null.`
      )

  return report
}

/** The log listing, checked entry by entry. */
export const normaliseLogFiles = (files: LogFileInfo[]): LogFileInfo[] => {
  if (!Array.isArray(files))
    throw new Error('The log report is not an array of files.')

  return files.map((file) => {
    if (!isObject(file))
      throw new Error('The log report carries an entry that is not an object.')

    const entry = file as unknown as Record<string, unknown>
    requireString(entry, 'name', 'logs')
    requireString(entry, 'modified', 'logs')
    requireNumber(entry, 'sizeBytes', 'logs')

    return file
  })
}

/**
 * A log file name the route will hand to a host.
 *
 * The rule is sasjs/server's, applied before the filesystem: a bare name ending
 * in `.log`. `.` and `..` are refused by the basename check, because both have a
 * basename equal to themselves and neither ends in `.log`.
 */
export const checkLogFileName = (fileName: string): string => {
  if (
    !fileName ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName.split(/[\\/]/).pop() !== fileName ||
    !fileName.toLowerCase().endsWith('.log')
  )
    throw new ApiError(400, 'Invalid log file name.')

  return fileName
}

/**
 * How many trailing lines to return.
 *
 * A caller's `lines` is text on the wire, so an absent or unusable value is the
 * documented default rather than a refusal - the parameter is a preference, not
 * a requirement. The ceiling is the document's maximum, so a host is never asked
 * to read more than it stated it would.
 */
export const logLines = (lines?: number | string): number => {
  // `?lines=` is absent in every sense that matters: a caller that sent the
  // parameter with no value asked for the default, not for zero lines
  if (lines === undefined || lines === null || lines === '')
    return DEFAULT_LOG_LINES

  const wanted = Number(lines)
  if (!Number.isFinite(wanted)) return DEFAULT_LOG_LINES
  return Math.min(Math.max(Math.trunc(wanted), 1), MAX_LOG_LINES)
}

/** The tail, checked against the shape the document states. */
const normaliseLogTail = (tail: LogTail): LogTail => {
  if (!isObject(tail)) throw new Error('The log tail report is not an object.')

  const entry = tail as unknown as Record<string, unknown>
  requireString(entry, 'fileName', 'log tail')
  requireString(entry, 'content', 'log tail')
  requireNumber(entry, 'lines', 'log tail')
  requireNumber(entry, 'bytesRead', 'log tail')
  if (typeof entry.truncated !== 'boolean')
    throw new Error(
      'The log tail report states `truncated` as something other than a boolean.'
    )

  return tail
}

/**
 * The admin service, over the host's reports.
 *
 * The name rule and the line clamp run here, before the host is asked for
 * anything: a host that resolves an unchecked name is a host that can be talked
 * into reading outside its log folder.
 */
export const createAdminService = (reports: AdminReports): AdminService => ({
  async diagnostics() {
    return normaliseDiagnostics(await reports.diagnostics())
  },

  async logs() {
    return normaliseLogFiles(await reports.logs())
  },

  async logTail(fileName: string, lines?: number | string) {
    const name = checkLogFileName(fileName)
    const tail = await reports.logTail(name, logLines(lines))

    if (tail === undefined) throw new ApiError(404, 'Log file not found.')

    return normaliseLogTail(tail)
  }
})
