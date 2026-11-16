/**
 * The read a streamed deployment links to.
 *
 * A build made with `streamWeb` names every asset by its path in the drive, so
 * the answer to one request decides whether the page works: the right
 * Content-Type, the right cache policy, and - when the file is not there - the
 * estate's own refusal rather than an API 404. All of it is decided here, so
 * the server and the browser build cannot disagree.
 */
import {
  createDeploymentFileService,
  DEPLOYMENT_FILE_ERROR
} from '../src/drive/deploymentFile.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import { dispatch } from '../src/host/dispatch.js'
import type { Services } from '../src/host/dispatch.js'
import { createDriveService } from '../src/drive/service.js'
import { ApiError, isApiError } from '../src/types.js'
import type { DriveStore } from '../src/types.js'

const store = (seed: Record<string, string | Uint8Array> = {}) =>
  new MemoryDriveStore(seed)

const service = (seed: Record<string, string | Uint8Array> = {}) =>
  createDeploymentFileService(store(seed))

/**
 * The dispatch services over ONE store, the way the corpus runner builds them: a
 * file the drive wrote has to be the file the streamed read fetches, or a future
 * write-then-read case would pass while asserting two different drives.
 */
const services = (seed: Record<string, string | Uint8Array> = {}): Services => {
  const shared = store(seed)

  return {
    drive: createDriveService(shared),
    deploymentFile: createDeploymentFileService(shared)
  }
}

/**
 * The same drive, whose read fails with `error` - the moment between the stat
 * that found the file and the read that follows it.
 */
const racy = (error: unknown) =>
  createDeploymentFileService(
    new Proxy(store({ '/Public/app/services/web/main.js': 'x' }), {
      get(target, property) {
        if (property === 'read')
          return async () => {
            throw error
          }

        const value = (target as DriveStore)[property as keyof DriveStore]

        return typeof value === 'function' ? value.bind(target) : value
      }
    })
  )

const status = async (promise: Promise<unknown>): Promise<number | string> => {
  try {
    await promise
    return 200
  } catch (error) {
    if (isApiError(error)) return error.status
    return String(error)
  }
}

describe('deployment file read', () => {
  it('types a script, a stylesheet and a page as themselves', async () => {
    const read = service({
      '/Public/app/services/web/main.js': 'console.log(1)',
      '/Public/app/services/web/style.css': 'body{}',
      '/Public/app/services/clickme.html': '<html></html>',
      '/Public/app/services/web/Roboto-Regular.ttf': 'font',
      '/Public/app/services/web/thing.weird': 'x'
    })

    for (const [path, type] of [
      ['/Public/app/services/web/main.js', 'text/javascript'],
      ['/Public/app/services/web/style.css', 'text/css'],
      ['/Public/app/services/clickme.html', 'text/html'],
      ['/Public/app/services/web/Roboto-Regular.ttf', 'font/ttf'],
      // nothing names it: bytes, rather than a guess
      ['/Public/app/services/web/thing.weird', 'application/octet-stream']
    ]) {
      const page = await read.read(path)

      expect(page.status).toEqual(200)
      expect(page.contentType).toContain(type)
    }
  })

  it('returns the bytes it read', async () => {
    const page = await service({
      '/Public/app/services/web/main.js': 'console.log(1)'
    }).read('/Public/app/services/web/main.js')

    expect(page.body).toEqual('console.log(1)')
  })

  it('caches a hashed name immutably and revalidates everything else', async () => {
    const read = service({
      '/Public/app/services/web/main.4f3a9c1d.js': 'console.log(1)',
      '/Public/app/services/clickme.html': '<html></html>'
    })

    // the same spelling the app stream's own answers use, so a host copying one
    // into the other cannot lose the policy
    expect(
      (await read.read('/Public/app/services/web/main.4f3a9c1d.js')).headers?.[
        'cache-control'
      ]
    ).toContain('immutable')

    expect(
      (await read.read('/Public/app/services/clickme.html')).headers?.[
        'cache-control'
      ]
    ).toContain('must-revalidate')
  })

  it('answers a missing file the way the estate does, not as a 404', async () => {
    const page = await service().read('/Public/app/services/web/gone.js')

    expect(page.status).toEqual(202)
    expect(page.body).toEqual(DEPLOYMENT_FILE_ERROR)
    expect(page.contentType).toContain('text/plain')
  })

  it('answers a folder the same way: there is no file to send', async () => {
    const page = await service({
      '/Public/app/services/web/main.js': 'x'
    }).read('/Public/app/services/web')

    expect(page.status).toEqual(202)
    expect(page.body).toEqual(DEPLOYMENT_FILE_ERROR)
  })

  it('answers 202 when the file is removed between the stat and the read', async () => {
    // the store said it was there a moment ago; the read finds nothing. The
    // answer is still the estate's - a caller must not see a 500 for the fault
    // this route exists to reproduce
    const page = await racy(
      Object.assign(new Error('gone'), { code: 'ENOENT' })
    ).read('/Public/app/services/web/main.js')

    expect(page.status).toEqual(202)
    expect(page.body).toEqual(DEPLOYMENT_FILE_ERROR)
  })

  it('answers 202 when a package store throws its own 404', async () => {
    const page = await racy(new ApiError(404, `File doesn't exist.`)).read(
      '/Public/app/services/web/main.js'
    )

    expect(page.status).toEqual(202)
  })

  it('lets any other store failure travel, rather than calling it missing', async () => {
    await expect(
      racy(Object.assign(new Error('denied'), { code: 'EACCES' })).read(
        '/Public/app/services/web/main.js'
      )
    ).rejects.toThrow('denied')
  })

  it('refuses a path that climbs out of the drive', async () => {
    expect(await status(service().read('../../etc/passwd'))).toEqual(400)
  })

  it('refuses the drive root and a blocked extension', async () => {
    expect(await status(service().read('/'))).toEqual(400)
    expect(await status(service().read('/Public/app/run.sh'))).toEqual(400)
  })
})

describe('the dispatch answer', () => {
  it('answers a _FILE request with the file, typed', async () => {
    const answer = await dispatch(
      services({ '/Public/app/services/web/main.js': 'console.log(1)' }),
      'GET /SASjsApi/drive/file',
      { query: { _FILE: '/Public/app/services/web/main.js' } }
    )

    expect(answer.status).toEqual(200)
    expect(answer.contents).toEqual('console.log(1)')
    expect(answer.contentType).toContain('text/javascript')
  })

  it('answers a missing _FILE the way the estate does', async () => {
    const answer = await dispatch(services(), 'GET /SASjsApi/drive/file', {
      query: { _FILE: '/Public/app/services/web/gone.js' }
    })

    expect(answer.status).toEqual(202)
    expect(answer.contents).toEqual(DEPLOYMENT_FILE_ERROR)
  })

  it('leaves the _filePath read as it was - bytes, no typing', async () => {
    const answer = await dispatch(
      services({ '/Public/app/services/web/main.js': 'console.log(1)' }),
      'GET /SASjsApi/drive/file',
      { query: { _filePath: '/Public/app/services/web/main.js' } }
    )

    expect(answer.status).toEqual(200)
    expect(answer.contents).toEqual('console.log(1)')
    expect(answer.contentType).toBeUndefined()
  })

  it('answers 400 when neither name is given, as it always did', async () => {
    await expect(
      dispatch(services(), 'GET /SASjsApi/drive/file', {})
    ).rejects.toThrow('"_filePath" is required')
  })

  it('answers 501 when the host has no deployment-file service', async () => {
    await expect(
      dispatch(
        { drive: createDriveService(store()) },
        'GET /SASjsApi/drive/file',
        { query: { _FILE: '/Public/app/services/web/main.js' } }
      )
    ).rejects.toThrow('no deployment-file service')
  })
})
