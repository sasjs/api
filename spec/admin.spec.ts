/**
 * The three Admin reports - diagnostics, the log listing, and one log's tail.
 *
 * The values are the host's; the decisions under test are the shape a client
 * renders, the log file name rule (a traversal must not reach a host's
 * filesystem), and the line count the route promises to bound.
 */
import {
  DEFAULT_LOG_LINES,
  MAX_LOG_LINES,
  createAdminService,
  logLines,
  normaliseDiagnostics,
  normaliseLogFiles
} from '../src/admin/service.js'
import type {
  AdminReports,
  DiagnosticsResponse,
  LogFileInfo,
  LogTail
} from '../src/admin/service.js'
import { ApiError, isApiError } from '../src/types.js'
import { dispatch } from '../src/host/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'

const diagnostics = (): DiagnosticsResponse => ({
  build: { version: 'v4.16.2', gitHash: 'cda6114', buildDate: null },
  server: {
    mode: 'server',
    uptimeSeconds: 3600,
    startedAt: '2026-11-08T15:00:00.000Z',
    pid: 1234,
    nodeVersion: 'v22.11.0',
    platform: 'linux 5.14.0',
    arch: 'x64',
    cpuCount: 8,
    cpuModel: 'Intel(R) Xeon(R) CPU',
    loadAverage: [0.08, 0.11, 0.15],
    runTimes: ['sas'],
    sasjsRoot: '/home/sasjssrv/sasjs_root'
  },
  memory: {
    rssBytes: 1,
    heapTotalBytes: 2,
    heapUsedBytes: 3,
    externalBytes: 4,
    systemTotalBytes: 5,
    systemFreeBytes: 6
  },
  filesystem: null,
  folders: [
    {
      label: 'sessions',
      path: '/home/sasjssrv/sasjs_root/sessions',
      exists: true,
      bytes: 346341376,
      files: 2411,
      truncated: false
    }
  ],
  logs: {
    folder: '/home/sasjssrv/sasjs_root/logs',
    fileCount: 1,
    totalBytes: 100,
    newestFile: '20261108150000.log',
    newestModified: '2026-11-08T15:01:00.000Z'
  }
})

const files = (): LogFileInfo[] => [
  {
    name: '20261108150000.log',
    sizeBytes: 100,
    modified: '2026-11-08T15:01:00.000Z'
  }
]

const tail = (fileName: string, lines: number): LogTail => ({
  fileName,
  lines: 1,
  bytesRead: 118,
  truncated: false,
  content: `GET /SASjsApi/info HTTP/1.1 200 118 (asked for ${lines})`
})

const reports = (): AdminReports => ({
  diagnostics: async () => diagnostics(),
  logs: async () => files(),
  logTail: async (fileName: string, lines: number) =>
    fileName === '20261108150000.log' ? tail(fileName, lines) : undefined
})

/** A synchronous refusal's message. */
const messageOf = (run: () => unknown): string => {
  try {
    run()
    return 'resolved'
  } catch (error) {
    return (error as Error).message
  }
}

/** An asynchronous refusal, as the error itself (a status, not only a message). */
const rejectionOf = async (run: () => Promise<unknown>): Promise<ApiError> => {
  try {
    await run()
    throw new Error('resolved')
  } catch (error) {
    return error as ApiError
  }
}

describe('the admin service', () => {
  it('answers the diagnostics report it was given', async () => {
    expect(await createAdminService(reports()).diagnostics()).toEqual(
      diagnostics()
    )
  })

  it('refuses a diagnostics report a client would render as NaN', () => {
    const missing = diagnostics() as unknown as Record<string, unknown>
    delete (missing.memory as Record<string, unknown>).rssBytes

    expect(messageOf(() => normaliseDiagnostics(missing as never))).toContain(
      '`rssBytes`'
    )

    const nan = diagnostics()
    nan.memory.rssBytes = Number.NaN
    expect(messageOf(() => normaliseDiagnostics(nan))).toContain(
      'the document states a number'
    )

    const wrongFilesystem = diagnostics() as unknown as Record<string, unknown>
    wrongFilesystem.filesystem = 'none'
    expect(
      messageOf(() => normaliseDiagnostics(wrongFilesystem as never))
    ).toContain('an object or null')
  })

  it('refuses a diagnostics report whose nested blocks are missing', () => {
    expect(
      messageOf(() => normaliseDiagnostics({ build: {} } as never))
    ).toContain('`version`')

    const noLogs = diagnostics() as unknown as Record<string, unknown>
    delete noLogs.logs
    expect(messageOf(() => normaliseDiagnostics(noLogs as never))).toContain(
      '`logs`'
    )
  })

  it('refuses a log listing whose entries are not the documented shape', () => {
    expect(
      messageOf(() => normaliseLogFiles([{ name: 'a.log' }] as never))
    ).toContain('`modified`')

    expect(messageOf(() => normaliseLogFiles('a.log' as never))).toContain(
      'not an array of files'
    )
  })

  it('refuses a log name that could leave the log folder', async () => {
    for (const name of [
      '../20261108150000.log',
      'logs/20261108150000.log',
      'logs\\20261108150000.log',
      '/etc/passwd.log',
      '20261108150000.txt',
      ''
    ]) {
      const error = await rejectionOf(() =>
        createAdminService(reports()).logTail(name)
      )

      expect({ name, status: error.status, message: error.message }).toEqual({
        name,
        status: 400,
        message: 'Invalid log file name.'
      })
    }
  })

  it('answers 404 when the log folder has no such file', async () => {
    const error = await rejectionOf(() =>
      createAdminService(reports()).logTail('20260101000000.log')
    )

    expect({ status: error.status, message: error.message }).toEqual({
      status: 404,
      message: 'Log file not found.'
    })
  })

  it('clamps the lines it asks the host for, and defaults them', async () => {
    // the parameter is a preference, not a requirement: absent or unreadable is
    // the documented default rather than a refusal
    expect(logLines(undefined)).toBe(DEFAULT_LOG_LINES)
    expect(logLines('')).toBe(DEFAULT_LOG_LINES)
    expect(logLines('abc')).toBe(DEFAULT_LOG_LINES)
    expect(logLines(0)).toBe(1)
    expect(logLines(-5)).toBe(1)
    expect(logLines(10)).toBe(10)
    expect(logLines(12.9)).toBe(12)
    expect(logLines(MAX_LOG_LINES + 1)).toBe(MAX_LOG_LINES)

    const asked: number[] = []
    const service = createAdminService({
      ...reports(),
      logTail: async (fileName: string, lines: number) => {
        asked.push(lines)
        return tail(fileName, lines)
      }
    })

    await service.logTail('20261108150000.log')
    await service.logTail('20261108150000.log', 5)
    await service.logTail('20261108150000.log', 999999)

    expect(asked).toEqual([DEFAULT_LOG_LINES, 5, MAX_LOG_LINES])
  })

  it('answers the tail it was given', async () => {
    const answer = await createAdminService(reports()).logTail(
      '20261108150000.log',
      10
    )

    expect(answer).toEqual(tail('20261108150000.log', 10))
  })

  it('refuses a tail whose shape a client cannot render', async () => {
    const broken = createAdminService({
      ...reports(),
      logTail: async () =>
        ({ fileName: 'a.log', content: 'x', lines: 1 }) as never
    })

    const error = await rejectionOf(() => broken.logTail('20261108150000.log'))

    expect(error.message).toContain('`bytesRead`')
  })

  it('refuses a diagnostics report whose arrays or folders break the shape', () => {
    const badLoad = diagnostics()
    ;(badLoad.server as unknown as Record<string, unknown>).loadAverage = [
      1,
      'x'
    ]
    expect(messageOf(() => normaliseDiagnostics(badLoad))).toContain(
      '`loadAverage`'
    )

    const badRunTimes = diagnostics()
    ;(badRunTimes.server as unknown as Record<string, unknown>).runTimes = 'sas'
    expect(messageOf(() => normaliseDiagnostics(badRunTimes))).toContain(
      '`runTimes`'
    )

    const noFolders = diagnostics() as unknown as Record<string, unknown>
    noFolders.folders = 'none'
    expect(messageOf(() => normaliseDiagnostics(noFolders as never))).toContain(
      '`folders`'
    )

    const badFolder = diagnostics()
    ;(badFolder.folders as unknown as unknown[])[0] = 'sessions'
    expect(messageOf(() => normaliseDiagnostics(badFolder))).toContain(
      'a folder that is not an object'
    )

    const badFolderField = diagnostics()
    badFolderField.folders[0].exists = 'yes' as never
    expect(messageOf(() => normaliseDiagnostics(badFolderField))).toContain(
      '`exists` or `truncated`'
    )

    const badNewest = diagnostics()
    badNewest.logs.newestFile = 4 as never
    expect(messageOf(() => normaliseDiagnostics(badNewest))).toContain(
      '`newestFile`'
    )

    const badBuildDate = diagnostics()
    badBuildDate.build.buildDate = 7 as never
    expect(messageOf(() => normaliseDiagnostics(badBuildDate))).toContain(
      '`buildDate`'
    )

    expect(messageOf(() => normaliseDiagnostics(null as never))).toBe(
      'The diagnostics report is not an object.'
    )
  })

  it('accepts a filesystem report, and refuses one a client cannot read', () => {
    const present = diagnostics()
    present.filesystem = {
      path: '/sasjs_root',
      totalBytes: 10,
      freeBytes: 6,
      usedBytes: 4,
      usedPercent: 40
    }
    expect(normaliseDiagnostics(present).filesystem).toEqual(present.filesystem)

    const noPath = diagnostics()
    noPath.filesystem = {
      totalBytes: 10,
      freeBytes: 6,
      usedBytes: 4,
      usedPercent: 40
    } as never
    expect(messageOf(() => normaliseDiagnostics(noPath))).toContain('`path`')

    const noBytes = diagnostics()
    noBytes.filesystem = {
      path: '/sasjs_root',
      totalBytes: 10,
      freeBytes: 6,
      usedBytes: 4
    } as never
    expect(messageOf(() => normaliseDiagnostics(noBytes))).toContain(
      '`usedPercent`'
    )
  })

  it('refuses a log listing entry that is not an object', () => {
    expect(
      messageOf(() => normaliseLogFiles([files()[0], 'a.log'] as never))
    ).toContain('an entry that is not an object')
  })

  it('refuses a tail that is not an object, or whose truncated is not a boolean', async () => {
    const notAnObject = createAdminService({
      ...reports(),
      logTail: async () => 'content' as never
    })
    expect(
      (await rejectionOf(() => notAnObject.logTail('20261108150000.log')))
        .message
    ).toContain('not an object')

    const notBoolean = createAdminService({
      ...reports(),
      logTail: async () => ({ ...tail('a.log', 1), truncated: 'no' }) as never
    })
    expect(
      (await rejectionOf(() => notBoolean.logTail('20261108150000.log')))
        .message
    ).toContain('`truncated`')
  })

  describe('the admin routes', () => {
    const drive = () => createDriveService(new MemoryDriveStore())

    it('answers each report through dispatch', async () => {
      const services = { drive: drive(), admin: createAdminService(reports()) }

      expect(
        (await dispatch(services, 'GET /SASjsApi/admin/diagnostics')).body
      ).toEqual(diagnostics())

      expect(
        (await dispatch(services, 'GET /SASjsApi/admin/logs')).body
      ).toEqual({
        files: files()
      })

      const tailed = await dispatch(
        services,
        'GET /SASjsApi/admin/logs/{fileName}',
        {
          params: { fileName: '20261108150000.log' },
          query: { lines: '10' }
        }
      )
      expect(tailed.status).toBe(200)
      expect((tailed.body as LogTail).fileName).toBe('20261108150000.log')
    })

    it('answers 501, naming the missing service, when the host supplies none', async () => {
      for (const route of [
        'GET /SASjsApi/admin/diagnostics',
        'GET /SASjsApi/admin/logs',
        'GET /SASjsApi/admin/logs/{fileName}'
      ]) {
        try {
          await dispatch({ drive: drive() }, route, {
            params: { fileName: '20261108150000.log' }
          })
          throw new Error('resolved')
        } catch (error) {
          expect(isApiError(error)).toBe(true)
          expect((error as { status: number }).status).toBe(501)
          expect((error as Error).message).toContain('has no admin service')
        }
      }
    })
  })
})
