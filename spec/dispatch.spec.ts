/**
 * The dispatcher's own edges: the answers that are about the API rather than
 * about the drive.
 */
import { dispatch, noHandler } from '../src/host/dispatch.js'
import { createRecordService } from '../src/identity/records.js'
import { createIdentityService } from '../src/identity/service.js'
import { MemoryIdentityStore } from '../src/identity/memory-store.js'
import { DEFAULT_IDENTITY } from '../src/identity/fixture.js'
import { createDriveService } from '../src/drive/service.js'
import { MemoryDriveStore } from '../src/drive/memory-store.js'
import {
  MemoryAppStreamStore,
  createAppStreamService
} from '../src/appstream/service.js'
import { isApiError } from '../src/types.js'
import { runCase, servicesFor, CORPUS_APP } from '../src/corpus/runner.js'
import type { CorpusCase } from '../src/corpus/drive.js'
import { DEPLOY_CORPUS } from '../src/corpus/deploy.js'
import { APP_CORPUS } from '../src/corpus/app.js'

const services = () => ({ drive: createDriveService(new MemoryDriveStore()) })

const failure = async (run: () => Promise<unknown>) => {
  try {
    await run()
    return 'resolved'
  } catch (error) {
    return isApiError(error)
      ? { status: error.status, message: error.message }
      : String(error)
  }
}

/** The shape a host without a sign-in flow supplies: records, nothing else. */
const recordsOnly = (): ReturnType<typeof createRecordService> =>
  createRecordService(new MemoryIdentityStore({ ...DEFAULT_IDENTITY }))

describe('dispatch', () => {
  it('fails closed when an authenticated host lacks permission records', async () => {
    const identity = createIdentityService(
      new MemoryIdentityStore(DEFAULT_IDENTITY)
    )
    const drive = createDriveService(
      new MemoryDriveStore({ '/data/private.csv': 'secret' })
    )
    expect(
      await failure(() =>
        dispatch({ drive, identity }, 'GET /SASjsApi/drive/file', {
          subject: { userId: 'user-restricted', clientId: 'web_app' },
          query: { _filePath: '/data/private.csv' }
        })
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no record service, so it cannot answer GET /SASjsApi/drive/file.'
    })
  })

  it('fails closed when a host receives a subject without permission records', async () => {
    const drive = createDriveService(
      new MemoryDriveStore({ '/data/private.csv': 'secret' })
    )
    expect(
      await failure(() =>
        dispatch({ drive }, 'GET /SASjsApi/drive/file', {
          subject: { userId: 'user-restricted', clientId: 'web_app' },
          query: { _filePath: '/data/private.csv' }
        })
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no record service, so it cannot answer GET /SASjsApi/drive/file.'
    })
  })

  it('honours a fileTree grant using the inventory spelling', async () => {
    const testCase: CorpusCase = {
      id: 'filetree-granted',
      route: 'GET /SASjsApi/drive/filetree',
      description: 'a non-administrator is granted the canonical fileTree path',
      identity: {
        ...DEFAULT_IDENTITY,
        permissions: [
          ...DEFAULT_IDENTITY.permissions,
          {
            uid: 'rule-filetree',
            path: '/SASjsApi/drive/fileTree',
            type: 'Route',
            setting: 'Grant',
            group: 'group-data-controller'
          }
        ]
      },
      request: { subject: { userId: 'user-restricted', clientId: 'web_app' } },
      expect: { status: 200 }
    }

    expect((await runCase(testCase)).status).toBe(200)
  })

  it('refuses an operation the table states but no case answers', () => {
    // unreachable while every operation has a handler; exported so the safety
    // net is itself tested rather than trusted
    const error = noHandler('GET /SASjsApi/nope')

    expect({ status: error.status, message: error.message }).toEqual({
      status: 501,
      message: 'This package has no handler for GET /SASjsApi/nope.'
    })
  })

  it('answers 404 for an operation the API does not have', async () => {
    // every operation in the table has a handler now, so the refusal a caller
    // can still reach is a path that is not in the document at all
    expect(
      await failure(() => dispatch(services(), 'GET /SASjsApi/nope'))
    ).toEqual({ status: 404, message: 'No such operation: GET /SASjsApi/nope' })
  })

  it('refuses the admin reports on a host with no record service, rather than serving them', async () => {
    // the reports need the administrator check, and the check needs the records;
    // a host that supplies one without the other is told what is missing instead
    // of answering its own log to any caller
    const admin = {
      diagnostics: async () => ({ filesystem: null }),
      logs: async () => [],
      logTail: async () => ({})
    }

    expect(
      await failure(() =>
        dispatch({ ...services(), admin } as never, 'GET /SASjsApi/admin/logs')
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no record service, so it cannot answer GET /SASjsApi/admin/logs.'
    })

    // and with a caller attached, so the answer is not the token refusal
    expect(
      await failure(() =>
        dispatch(
          { ...services(), admin } as never,
          'GET /SASjsApi/admin/logs',
          { subject: { userId: 'user-admin', clientId: 'web_app' } }
        )
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no record service, so it cannot answer GET /SASjsApi/admin/logs.'
    })
  })

  it('answers the token refusal for an account that may no longer act', async () => {
    // a server re-reads the account before the administrator middleware runs, so
    // a token that outlived it meets `Unauthorized`, not the admin wording
    const store = new MemoryIdentityStore({
      ...DEFAULT_IDENTITY,
      users: DEFAULT_IDENTITY.users.map((user) =>
        user.uid === 'user-restricted' ? { ...user, isActive: false } : user
      )
    })
    const admin = {
      diagnostics: async () => ({ filesystem: null }),
      logs: async () => [],
      logTail: async () => ({})
    }

    expect(
      await failure(() =>
        dispatch(
          {
            ...services(),
            admin,
            records: createRecordService(store)
          } as never,
          'GET /SASjsApi/admin/logs',
          { subject: { userId: 'user-restricted', clientId: 'web_app' } }
        )
      )
    ).toEqual({ status: 401, message: 'Unauthorized' })
  })

  it('answers 501 for a record route when the host supplies no record service', async () => {
    // the services are optional: a host that has a drive but no identity records
    // answers these routes the same way it answers one this package never wrote,
    // and the message says which dependency is missing rather than "no handler"
    expect(
      await failure(() => dispatch(services(), 'GET /SASjsApi/user'))
    ).toEqual({
      status: 501,
      message:
        'This host has no record service, so it cannot answer GET /SASjsApi/user.'
    })
  })

  it('answers 501 for a session route when the host supplies no session service', async () => {
    // same rule as the records above: the four session routes need something the
    // package cannot invent - the run time that holds the sessions - and the
    // message names it rather than reporting "no handler"
    expect(
      await failure(() =>
        dispatch(services(), 'GET /SASjsApi/session/{sessionId}', {
          params: { sessionId: 'sess-admin' }
        })
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no session service, so it cannot answer GET /SASjsApi/session/{sessionId}.'
    })
  })

  it('answers 501 for an unpublish when the host has no app stream', async () => {
    expect(
      await failure(() =>
        dispatch(services(), 'DELETE /SASjsApi/drive/deploy', {
          body: { id: '6f1c1c1e-6a1e-4c4a-9d1a-1b2c3d4e5f60' }
        })
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no app stream, so it cannot answer DELETE /SASjsApi/drive/deploy.'
    })
  })

  it('answers 501 for an app detail when the host has no app stream', async () => {
    expect(
      await failure(() =>
        dispatch(services(), 'GET /SASjsApi/app/{id}', {
          params: { id: '6f1c1c1e-6a1e-4c4a-9d1a-1b2c3d4e5f60' }
        })
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no app stream, so it cannot answer GET /SASjsApi/app/{id}.'
    })
  })

  it('describes an app with the fields the index carries, and only those', async () => {
    const drive = createDriveService(new MemoryDriveStore({}))
    const appStream = createAppStreamService(
      new MemoryAppStreamStore([
        {
          id: '6f1c1c1e-6a1e-4c4a-9d1a-1b2c3d4e5f60',
          name: 'myApp',
          appLoc: '/Public/myApp',
          streamWebFolder: 'web',
          logo: 'logo.png',
          frameAncestors: ['https://portal.example.com'],
          publishedAt: '2026-01-01T00:00:00.000Z'
        }
      ])
    )

    const answer = (await dispatch(
      { drive, appStream },
      'GET /SASjsApi/app/{id}',
      { params: { id: '6f1c1c1e-6a1e-4c4a-9d1a-1b2c3d4e5f60' } }
    )) as { status: number; body: Record<string, unknown> }

    expect(answer.body).toMatchObject({
      logo: 'logo.png',
      frameAncestors: ['https://portal.example.com'],
      entryFileExists: false,
      lastModified: null
    })
  })

  it('lets a drive read that is not “folder gone” through, rather than reporting no file', async () => {
    // the app's streamed folder is a FILE here, so the tree answers `400 Not a
    // Folder.` - not the 404 that means "the deployment is gone", and not something
    // this route may answer with `entryFileExists: false`
    const drive = createDriveService(
      new MemoryDriveStore({ '/Public/myApp/services/web': 'not a folder' })
    )
    const appStream = createAppStreamService(
      new MemoryAppStreamStore([
        {
          id: '6f1c1c1e-6a1e-4c4a-9d1a-1b2c3d4e5f60',
          name: 'myApp',
          appLoc: '/Public/myApp',
          streamWebFolder: 'web',
          publishedAt: '2026-01-01T00:00:00.000Z'
        }
      ])
    )

    expect(
      await failure(() =>
        dispatch({ drive, appStream }, 'GET /SASjsApi/app/{id}', {
          params: { id: '6f1c1c1e-6a1e-4c4a-9d1a-1b2c3d4e5f60' }
        })
      )
    ).toEqual({ status: 400, message: 'Not a Folder.' })
  })

  it('treats a request that names no id as one the index does not hold', async () => {
    const drive = createDriveService(new MemoryDriveStore({}))
    const appStream = createAppStreamService(new MemoryAppStreamStore())

    expect(
      await failure(() =>
        dispatch({ drive, appStream }, 'GET /SASjsApi/app/{id}', {})
      )
    ).toEqual({
      status: 404,
      message: 'No App Stream is registered with that id.'
    })
  })

  it('lets a failure that is not the index refusing the id through', async () => {
    // a drive read that broke is not "no such app": the route's own 404 is the
    // index's answer, and anything else has to reach the host's 500
    const drive = createDriveService(new MemoryDriveStore({}))
    const appStream = {
      list: async () => [],
      get: async () => {
        throw new Error('EIO: i/o error, read')
      }
    } as unknown as ReturnType<typeof createAppStreamService>

    const answer = (await failure(() =>
      dispatch({ drive, appStream }, 'GET /SASjsApi/app/{id}', {
        params: { id: '6f1c1c1e-6a1e-4c4a-9d1a-1b2c3d4e5f60' }
      })
    )) as string

    expect(answer).toContain('EIO')
  })

  it('refuses a publish before it writes the deployment the publish describes', async () => {
    const drive = createDriveService(new MemoryDriveStore({}))
    const appStream = createAppStreamService(new MemoryAppStreamStore())

    const answer = await failure(() =>
      dispatch({ drive, appStream }, 'POST /SASjsApi/drive/deploy', {
        body: {
          appLoc: '/Public/apps/x',
          // the index refuses this, and the drive must not already have the
          // tree by the time it does
          streamWebFolder: '../escape',
          fileTree: {
            members: [{ name: 'index.html', type: 'file', code: '<h1>x</h1>' }]
          }
        }
      })
    )

    expect(answer).toEqual({
      status: 400,
      message: 'streamWebFolder must be a single path segment.'
    })

    await expect(drive.tree('/Public/apps/x')).rejects.toMatchObject({
      status: 404
    })
    expect(await appStream.list()).toEqual([])
  })

  it('takes the upload route’s folder from the query, and replaces the folder by default', async () => {
    const drive = createDriveService(new MemoryDriveStore({}))
    const appStream = createAppStreamService(new MemoryAppStreamStore())
    const services = { drive, appStream }

    /** A tree carrying the folder the app is served from, and one extra file. */
    const tree = (code: string, extra = true) => ({
      members: [
        {
          name: 'services',
          type: 'folder',
          members: [
            {
              name: 'web',
              type: 'folder',
              members: [
                { name: 'index.html', type: 'file', code },
                ...(extra
                  ? [{ name: 'old.html', type: 'file', code: '<h1>old</h1>' }]
                  : [])
              ]
            }
          ]
        }
      ]
    })

    // the document states `appLoc` and `streamWebFolder` in the QUERY on this
    // route, because the archive is the body
    const first = await dispatch(
      services,
      'POST /SASjsApi/drive/deploy/upload',
      {
        query: { appLoc: '/Public/apps/q', streamWebFolder: 'web' },
        body: { fileTree: tree('<h1>one</h1>') }
      }
    )

    expect(first.status).toBe(200)

    const published = first.body as { app: { id: string; name: string } }

    expect(published.app).toMatchObject({ name: 'q' })
    expect(
      (await drive.read('/Public/apps/q/services/web/index.html')).contents
    ).toEqual('<h1>one</h1>')

    // an archive upload is the folder's whole contents, so a second, smaller
    // tree leaves nothing of the first behind - and keeps the app's id
    const second = await dispatch(
      services,
      'POST /SASjsApi/drive/deploy/upload',
      {
        query: { appLoc: '/Public/apps/q', streamWebFolder: 'web' },
        body: { fileTree: tree('<h1>two</h1>', false) }
      }
    )

    expect(second.status).toBe(200)
    expect((second.body as { app: { id: string } }).app.id).toBe(
      published.app.id
    )
    await expect(
      drive.read('/Public/apps/q/services/web/old.html')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('prefers the upload route’s query over its body, as the document orders them', async () => {
    const drive = createDriveService(new MemoryDriveStore({}))

    // both places state a folder: the document puts the query first on this route,
    // so that is the one a host has to read - a body-first host would deploy to a
    // folder the caller did not choose
    const answer = await dispatch(
      { drive } as any,
      'POST /SASjsApi/drive/deploy/upload',
      {
        query: { appLoc: '/Public/apps/from-query' },
        body: {
          appLoc: '/Public/apps/from-body',
          fileTree: {
            members: [{ name: 'a.html', type: 'file', code: '<h1>a</h1>' }]
          }
        }
      }
    )

    expect(answer.status).toBe(200)
    expect(
      (await drive.read('/Public/apps/from-query/a.html')).contents
    ).toEqual('<h1>a</h1>')
    await expect(
      drive.read('/Public/apps/from-body/a.html')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('takes an upload’s folder from the body when the query is silent', async () => {
    const drive = createDriveService(new MemoryDriveStore({}))

    // a host that expands the archive before it dispatches has the fields in the
    // body and no query to put them in: the document states them in the query, so
    // that is where they belong, but the fallback is what such a host relies on
    const answer = await dispatch(
      { drive } as any,
      'POST /SASjsApi/drive/deploy/upload',
      {
        body: {
          appLoc: '/Public/apps/from-body',
          fileTree: {
            members: [{ name: 'a.html', type: 'file', code: '<h1>a</h1>' }]
          }
        }
      }
    )

    expect(answer.status).toBe(200)
    expect(
      (await drive.read('/Public/apps/from-body/a.html')).contents
    ).toEqual('<h1>a</h1>')
  })

  it('keeps what is already there when the JSON route is not told to replace', async () => {
    const drive = createDriveService(new MemoryDriveStore({}))
    const services = { drive }

    const deploy = (names: string[], replace?: boolean) =>
      dispatch(services, 'POST /SASjsApi/drive/deploy', {
        body: {
          appLoc: '/Public/apps/json',
          replace,
          fileTree: {
            members: names.map((name) => ({
              name,
              type: 'file',
              code: '<h1>x</h1>'
            }))
          }
        }
      })

    await deploy(['a.html', 'b.html'])
    // no stream named, so these are files rather than an app
    await deploy(['a.html'])

    expect((await drive.read('/Public/apps/json/b.html')).contents).toEqual(
      '<h1>x</h1>'
    )

    // and told to replace, the folder is what the tree says it is
    await deploy(['a.html'], true)

    await expect(drive.read('/Public/apps/json/b.html')).rejects.toMatchObject({
      status: 404
    })
  })

  it('takes the JSON route’s folder from the body, whatever the query says', async () => {
    const drive = createDriveService(new MemoryDriveStore({}))

    // the document states appLoc in the body on this route, so a stray query key
    // must not quietly redeploy somewhere else
    const answer = await dispatch(
      { drive } as any,
      'POST /SASjsApi/drive/deploy',
      {
        query: { appLoc: '/Public/apps/from-query' },
        body: {
          appLoc: '/Public/apps/from-body',
          fileTree: {
            members: [{ name: 'a.html', type: 'file', code: '<h1>a</h1>' }]
          }
        }
      }
    )

    expect(answer.status).toBe(200)
    expect(
      (await drive.read('/Public/apps/from-body/a.html')).contents
    ).toEqual('<h1>a</h1>')
    await expect(
      drive.read('/Public/apps/from-query/a.html')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('hands the format route the layout flag the request carried', async () => {
    // the dispatcher rebuilds this route's body field by field, so a flag the
    // service reads is dropped unless it is named here - and the Studio's lint-fix
    // button sends `layout: false` for exactly this to survive the trip
    const seen: (boolean | undefined)[] = []
    const code = {
      lint: async () => [],
      format: async (_caller: unknown, body: { layout?: boolean }) => {
        seen.push(body.layout)
        return 'data a;\nrun;\n'
      }
    }

    const send = async (layout: unknown) => {
      const answer = await dispatch(
        { code } as any,
        'POST /SASjsApi/code/format',
        {
          subject: { userId: 'user-admin', clientId: 'web_app' },
          body: { code: 'data a; run;', layout }
        }
      )

      expect(answer.status).toBe(200)
    }

    for (const layout of [false, true, undefined]) await send(layout)

    // the spellings the server's schema converts, so a client that sent a string
    // is answered the way it would be by an installation: Joi 18 reads the two
    // words case-insensitively and trims them, so `' TRUE '` is the same request
    // as `true`
    await send('false')
    await send('true')
    await send(' true ')
    await send('TRUE')

    expect(seen).toEqual([false, true, undefined, false, true, true, true])
  })

  it('refuses a layout value the document does not allow', async () => {
    // the answer an installation gives these, because guessing leaves a caller's
    // mistake unanswered - `"yes"` read as the default would run the engine and
    // report 200. `["true"]` is the shape that a `String(value)` conversion would
    // have let through: it stringifies to 'true', and the schema refuses it.
    const code = {
      lint: async () => [],
      format: async () => 'data a;\nrun;\n'
    }

    for (const layout of ['yes', 0, '', null, ['true'], { layout: true }]) {
      expect(
        await failure(() =>
          dispatch({ code } as any, 'POST /SASjsApi/code/format', {
            subject: { userId: 'user-admin', clientId: 'web_app' },
            body: { code: 'data a; run;', layout }
          })
        )
      ).toEqual({ status: 400, message: '"layout" must be a boolean' })
    }
  })

  it('refuses a boolean body field the document does not allow', async () => {
    // the same rule `layout` settled, on the fields the user and group routes
    // read as booleans: an installation answers `"isAdmin" must be a boolean` and
    // this package used to pass `"yes"` straight to the record service
    const store = new MemoryIdentityStore({ ...DEFAULT_IDENTITY })
    const services = { records: createRecordService(store) } as any
    const subject = { userId: 'user-admin', clientId: 'web_app' }

    const cases: [string, Record<string, unknown>, string][] = [
      [
        'POST /SASjsApi/user',
        {
          username: 'newuser',
          displayName: 'New User',
          password: 'password',
          isAdmin: 'yes'
        },
        'isAdmin'
      ],
      [
        'POST /SASjsApi/user',
        {
          username: 'newuser',
          displayName: 'New User',
          password: 'password',
          isActive: 'no'
        },
        'isActive'
      ],
      [
        'POST /SASjsApi/group',
        { name: 'newgroup', description: 'a group', isActive: 'sometimes' },
        'isActive'
      ],
      [
        // the minimal update the schema allows: the flags are the only fields
        // such a request needs to carry
        'PATCH /SASjsApi/user/{uid}',
        { isAdmin: 'yes' },
        'isAdmin'
      ],
      // the shapes a `String(value)` conversion would have read as the flag: an
      // array stringifies to 'true', and a number to '1', which is neither
      [
        'POST /SASjsApi/user',
        {
          username: 'newuser',
          displayName: 'One User',
          password: 'password',
          isAdmin: ['true']
        },
        'isAdmin'
      ],
      [
        'POST /SASjsApi/user',
        {
          username: 'newuser',
          displayName: 'One User',
          password: 'password',
          isAdmin: 1
        },
        'isAdmin'
      ],
      [
        'POST /SASjsApi/user',
        {
          username: 'newuser',
          displayName: 'One User',
          password: 'password',
          isAdmin: '1'
        },
        'isAdmin'
      ]
    ]

    for (const [routeId, body, field] of cases) {
      expect(
        await failure(() =>
          dispatch(services, routeId, {
            subject,
            params: { uid: 'user-restricted' },
            body: body as any
          })
        )
      ).toEqual({ status: 400, message: `"${field}" must be a boolean` })
    }
  })

  it('reads the spellings the schema converts on those routes too', async () => {
    // `"TRUE"` is what Joi.boolean() means by true, so it is stored as one
    const store = new MemoryIdentityStore({ ...DEFAULT_IDENTITY })
    const services = { records: createRecordService(store) } as any

    const answer = await dispatch(services, 'POST /SASjsApi/user', {
      subject: { userId: 'user-admin', clientId: 'web_app' },
      body: {
        username: 'stringspelled',
        displayName: 'String Spelled',
        password: 'password',
        isAdmin: 'TRUE'
      } as any
    })

    expect(answer.status).toBe(200)
    expect((answer.body as { isAdmin?: boolean }).isAdmin).toBe(true)
  })

  it('refuses an admin-only flag from a caller who is not an admin', async () => {
    // the installation declares `isAdmin` and `isActive` on this body only for an
    // administrator, so a signed-in user that sends one is refused before the
    // controller could apply it to their own account. Without that half the
    // conversion would let any user promote themselves here and nowhere else.
    const store = new MemoryIdentityStore({ ...DEFAULT_IDENTITY })
    const services = { records: createRecordService(store) } as any

    const answer = await failure(() =>
      dispatch(services, 'PATCH /SASjsApi/user/{uid}', {
        subject: { userId: 'user-restricted', clientId: 'web_app' },
        params: { uid: 'user-restricted' },
        body: { isAdmin: true } as any
      })
    )

    expect(answer).toEqual({ status: 400, message: '"isAdmin" is not allowed' })

    // and nothing was applied to the account
    const user = await services.records.getUser(
      { userId: 'user-admin', clientId: 'web_app' },
      { uid: 'user-restricted' }
    )
    expect(user.isAdmin).toBe(false)
  })

  it('applies an admin-only flag when the caller is an admin', async () => {
    // the payload a non-admin is refused is the one an administrator's update
    // converts and stores, so the difference in the two answers is the caller
    const store = new MemoryIdentityStore({ ...DEFAULT_IDENTITY })
    const services = { records: createRecordService(store) } as any
    const admin = { userId: 'user-admin', clientId: 'web_app' }

    const answer = await dispatch(services, 'PATCH /SASjsApi/user/{uid}', {
      subject: admin,
      params: { uid: 'user-restricted' },
      body: { isAdmin: 'TRUE' } as any
    })

    expect(answer.status).toBe(200)

    const user = await services.records.getUser(admin, {
      uid: 'user-restricted'
    })
    expect(user.isAdmin).toBe(true)
  })

  it('asks about the caller before it asks about the body', async () => {
    // the installation mounts `authenticateAccessToken`, then `verifyAdmin` /
    // `verifyAdminIfNeeded`, and only then the schema - so the caller refusals
    // come first. Converting the body first would answer 400 to a request an
    // installation refuses as 401, and would say which field was wrong to a
    // caller who is not allowed to know.
    const store = new MemoryIdentityStore({ ...DEFAULT_IDENTITY })
    const services = { records: createRecordService(store) } as any
    const restricted = { userId: 'user-restricted', clientId: 'web_app' }
    const update = {
      displayName: 'Restricted One',
      username: 'restrictedone',
      password: 'password',
      isAdmin: 'yes'
    }

    // a non-admin creating an account: the admin gate, not the field
    expect(
      await failure(() =>
        dispatch(services, 'POST /SASjsApi/user', {
          subject: restricted,
          body: { ...update, username: 'someone-new' } as any
        })
      )
    ).toEqual({ status: 401, message: 'Admin account required' })

    // a non-admin acting on another account: the same gate
    expect(
      await failure(() =>
        dispatch(services, 'PATCH /SASjsApi/user/{uid}', {
          subject: restricted,
          params: { uid: 'user-admin' },
          body: update as any
        })
      )
    ).toEqual({ status: 401, message: 'Admin account required' })

    // a caller the store does not hold: the token gate, which is what the
    // installation sends before any schema runs
    expect(
      await failure(() =>
        dispatch(services, 'PATCH /SASjsApi/user/{uid}', {
          subject: { userId: 'no-such-user', clientId: 'web_app' },
          params: { uid: 'user-restricted' },
          body: update as any
        })
      )
    ).toEqual({ status: 401, message: 'Unauthorized' })

    // the group create route gates the caller the same way, before the flag
    expect(
      await failure(() =>
        dispatch(services, 'POST /SASjsApi/group', {
          subject: restricted,
          body: { name: 'g', description: 'd', isActive: 'sometimes' } as any
        })
      )
    ).toEqual({ status: 401, message: 'Admin account required' })

    // and an incomplete body does not pre-empt the gate either: the shared field
    // check runs after the caller questions on these routes, as the middleware
    // order has it, so a missing password is the answer only to an admin
    expect(
      await failure(() =>
        dispatch(services, 'POST /SASjsApi/user', {
          subject: restricted,
          body: { username: 'x', displayName: 'X', isAdmin: 'yes' } as any
        })
      )
    ).toEqual({ status: 401, message: 'Admin account required' })

    expect(
      await failure(() =>
        dispatch(services, 'PATCH /SASjsApi/user/{uid}', {
          subject: restricted,
          params: { uid: 'user-admin' },
          body: { username: 'user-admin' } as any
        })
      )
    ).toEqual({ status: 401, message: 'Admin account required' })

    // while an admin's incomplete body is still the field complaint it always was
    expect(
      await failure(() =>
        dispatch(services, 'POST /SASjsApi/user', {
          subject: { userId: 'user-admin', clientId: 'web_app' },
          body: { username: 'newuser', displayName: 'New User' } as any
        })
      )
    ).toEqual({ status: 400, message: '"password" is required' })
  })

  it('applies the update schema rather than the document on the update routes', async () => {
    // the document marks displayName, username and password required; the schema
    // makes them optional and states rules of its own, so the rules are what a
    // caller meets - and the values Joi converts are converted before the service
    const store = new MemoryIdentityStore({ ...DEFAULT_IDENTITY })
    const services = { records: createRecordService(store) } as any
    const admin = { userId: 'user-admin', clientId: 'web_app' }

    const refusal = async (body: Record<string, unknown>) =>
      failure(() =>
        dispatch(services, 'PATCH /SASjsApi/user/{uid}', {
          subject: admin,
          params: { uid: 'user-restricted' },
          body: body as any
        })
      )

    expect(await refusal({ displayName: 'short' })).toEqual({
      status: 400,
      message: '"displayName" length must be at least 6 characters long'
    })
    expect(await refusal({ username: 'a-b' })).toEqual({
      status: 400,
      message: '"username" must only contain alpha-numeric characters'
    })
    expect(await refusal({ password: 'abc' })).toEqual({
      status: 400,
      message: '"password" length must be at least 6 characters long'
    })
    // an empty value is refused as empty, before any length rule: a name of
    // spaces trims to nothing, which is what an installation answers
    expect(await refusal({ displayName: '' })).toEqual({
      status: 400,
      message: '"displayName" is not allowed to be empty'
    })
    expect(await refusal({ displayName: '   ' })).toEqual({
      status: 400,
      message: '"displayName" is not allowed to be empty'
    })
    expect(await refusal({ username: '' })).toEqual({
      status: 400,
      message: '"username" is not allowed to be empty'
    })
    expect(await refusal({ password: '' })).toEqual({
      status: 400,
      message: '"password" is not allowed to be empty'
    })
    expect(await refusal({ displayName: 5 })).toEqual({
      status: 400,
      message: '"displayName" must be a string'
    })
    expect(await refusal({ username: 'ab' })).toEqual({
      status: 400,
      message: '"username" length must be at least 3 characters long'
    })
    expect(await refusal({ username: 'a'.repeat(17) })).toEqual({
      status: 400,
      message:
        '"username" length must be less than or equal to 16 characters long'
    })
    expect(await refusal({ password: 'a'.repeat(1025) })).toEqual({
      status: 400,
      message:
        '"password" length must be less than or equal to 1024 characters long'
    })
    expect(await refusal({ autoExec: 5 })).toEqual({
      status: 400,
      message: '"autoExec" must be a string'
    })
    expect(await refusal({ nonsense: 1 })).toEqual({
      status: 400,
      message: '"nonsense" is not allowed'
    })

    // the flag on a non-admin's own account is an unknown key like any other, and
    // Joi reports whichever the body states first
    expect(
      await failure(() =>
        dispatch(services, 'PATCH /SASjsApi/user/{uid}', {
          subject: { userId: 'user-restricted', clientId: 'web_app' },
          params: { uid: 'user-restricted' },
          body: { nonsense: 1, isAdmin: true } as any
        })
      )
    ).toEqual({ status: 400, message: '"nonsense" is not allowed' })

    // and a folded username, as `Joi.string().lowercase()` folds it
    const answer = await dispatch(services, 'PATCH /SASjsApi/user/{uid}', {
      subject: admin,
      params: { uid: 'user-restricted' },
      body: { username: 'MixedCase' } as any
    })

    expect(answer.status).toBe(200)
    expect((answer.body as { username?: string }).username).toBe('mixedcase')
  })

  it('enforces the create schemas the controllers state', async () => {
    // the same class as the update routes: the document checks presence, the
    // controller's schema checks the rules too, and in its own order
    const store = new MemoryIdentityStore({ ...DEFAULT_IDENTITY })
    const services = { records: createRecordService(store) } as any
    const admin = { userId: 'user-admin', clientId: 'web_app' }

    const refusedBody = async (
      routeId: string,
      body: Record<string, unknown>
    ) =>
      failure(() =>
        dispatch(services, routeId, { subject: admin, body: body as any })
      )

    expect(
      await refusedBody('POST /SASjsApi/user', { username: 'newuser' })
    ).toEqual({ status: 400, message: '"displayName" is required' })
    expect(
      await refusedBody('POST /SASjsApi/user', {
        displayName: 'New User',
        username: 'newuser'
      })
    ).toEqual({ status: 400, message: '"password" is required' })
    expect(
      await refusedBody('POST /SASjsApi/user', {
        displayName: 'New User',
        username: 'a-b',
        password: 'password'
      })
    ).toEqual({
      status: 400,
      message: '"username" must only contain alpha-numeric characters'
    })
    expect(
      await refusedBody('POST /SASjsApi/user', {
        displayName: 'New User',
        username: 'newuser',
        password: 'password',
        extra: 1
      })
    ).toEqual({ status: 400, message: '"extra" is not allowed' })

    // an unknown key and an unreadable flag in one body: the schema reports its
    // own keys in schema order and the unknown ones last
    expect(
      await refusedBody('POST /SASjsApi/user', {
        displayName: 'New User',
        username: 'newuser',
        password: 'password',
        extra: 1,
        isAdmin: 'yes'
      })
    ).toEqual({ status: 400, message: '"isAdmin" must be a boolean' })

    // and the flags come before `autoExec`, where the schema declares them
    expect(
      await refusedBody('POST /SASjsApi/user', {
        displayName: 'New User',
        username: 'newuser',
        password: 'password',
        isAdmin: 'yes',
        autoExec: 5
      })
    ).toEqual({ status: 400, message: '"isAdmin" must be a boolean' })
    expect(
      await refusedBody('POST /SASjsApi/user', {
        displayName: 'New User',
        username: 'newuser',
        password: 'password',
        isActive: 'sometimes',
        autoExec: 5
      })
    ).toEqual({ status: 400, message: '"isActive" must be a boolean' })

    expect(await refusedBody('POST /SASjsApi/group', { name: 'ab' })).toEqual({
      status: 400,
      message: '"name" length must be at least 3 characters long'
    })
    expect(await refusedBody('POST /SASjsApi/group', { name: 'a-b' })).toEqual({
      status: 400,
      message: '"name" must only contain alpha-numeric characters'
    })
    expect(
      await refusedBody('POST /SASjsApi/group', {
        name: 'abc',
        description: ''
      })
    ).toEqual({
      status: 400,
      message: '"description" is not allowed to be empty'
    })
    expect(
      await refusedBody('POST /SASjsApi/group', {
        name: 'abc',
        extra: 1,
        isActive: 'yes'
      })
    ).toEqual({ status: 400, message: '"isActive" must be a boolean' })
  })

  it('answers 501 where the route needs a service the host does not have', async () => {
    for (const routeId of [
      'POST /SASjsApi/code/lint',
      'POST /SASjsApi/code/format'
    ]) {
      const answer = await failure(() =>
        dispatch({} as any, routeId, { body: { code: 'data a; run;' } })
      )

      expect(answer).toMatchObject({ status: 501 })
      expect(String((answer as { message?: string }).message)).toContain(
        routeId
      )
    }

    // a route the table does not state never reaches a handler at all
    const unknown = await failure(() =>
      dispatch({} as any, 'POST /SASjsApi/not/a/route' as any, { body: {} })
    )

    expect(unknown).toMatchObject({ status: 404 })
  })

  it('refuses a replace it cannot read, rather than guessing', async () => {
    const drive = createDriveService(new MemoryDriveStore({}))

    const answer = await failure(() =>
      dispatch({ drive } as any, 'POST /SASjsApi/drive/deploy/upload', {
        query: { appLoc: '/Public/apps/x', replace: 'sometimes' },
        body: {
          fileTree: {
            members: [{ name: 'index.html', type: 'file', code: '<h1>x</h1>' }]
          }
        }
      })
    )

    expect(answer).toEqual({
      status: 400,
      message: '"replace" must be true or false.'
    })

    // and nothing was written, because the refusal comes before the deploy
    await expect(drive.tree('/Public/apps/x')).rejects.toMatchObject({
      status: 404
    })
  })

  it('answers 501 on a record route when it has records but no identity service', async () => {
    // a records-only host can answer, but only for a caller it resolved itself:
    // without a subject there is nothing to authenticate, and a 401 would put a
    // host without a sign-in flow into a login loop
    expect(
      await failure(() =>
        dispatch(
          { ...services(), records: recordsOnly() },
          'GET /SASjsApi/user'
        )
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no identity service, so it cannot answer GET /SASjsApi/user.'
    })
  })

  it('serves a record route for a caller the host resolved itself', async () => {
    const answer = await dispatch(
      { ...services(), records: recordsOnly() },
      'GET /SASjsApi/user',
      {
        subject: { userId: 'user-admin', clientId: 'web_app' }
      }
    )

    expect(answer.status).toBe(200)
  })

  it('answers 501 for a sign-in route when the host supplies no identity service', async () => {
    expect(
      await failure(() =>
        dispatch(services(), 'POST /SASLogon/login', {
          body: { username: 'sasjsadmin', password: 'Orion123' }
        })
      )
    ).toEqual({
      status: 501,
      message:
        'This host has no identity service, so it cannot answer POST /SASLogon/login.'
    })
  })

  it('validates a required parameter before the handler runs', async () => {
    // the table says newPath is required, so the handler never sees the request
    expect(
      await failure(() =>
        dispatch(services(), 'POST /SASjsApi/drive/rename', {
          body: { oldPath: '/a' }
        })
      )
    ).toEqual({ status: 400, message: '"newPath" is required' })
  })
})

describe('corpus runner', () => {
  it('lets an error that is not an API refusal through, rather than reporting it as a status', async () => {
    // a store that breaks is a bug in the host, not a decision the API made;
    // turning it into a 500 here would hide it from the suite
    const testCase: CorpusCase = {
      id: 'broken-store',
      route: 'GET /SASjsApi/drive/folder',
      description: 'a store that throws',
      request: {},
      expect: { status: 200 }
    }
    const broken = {
      ...servicesFor(testCase).drive,
      list: () => {
        throw new Error('store is broken')
      }
    }

    await expect(runCase(testCase, { drive: broken })).rejects.toThrow(
      'store is broken'
    )
  })
})

describe('a package, on a host with no app stream', () => {
  it('is refused rather than deployed to a folder that would not be served', async () => {
    const testCase = DEPLOY_CORPUS.find(
      (candidate) => candidate.id === 'deploy-publishes-a-package'
    ) as CorpusCase

    const { appStream, ...withoutIndex } = servicesFor(testCase)

    expect(
      await failure(() =>
        dispatch(withoutIndex, testCase.route, testCase.request)
      )
    ).toMatchObject({
      status: 501,
      message: /no app stream/
    })
    expect(appStream).toBeDefined()
  })
})

describe('a package whose backend names no folder', () => {
  it('is refused rather than deployed with its services dropped', async () => {
    const testCase = DEPLOY_CORPUS.find(
      (candidate) => candidate.id === 'deploy-refuses-a-backend-with-no-apploc'
    ) as CorpusCase

    // `runCase` turns the API's refusal into a result rather than throwing, so the
    // sentence both hosts answer is what the case is asserted on
    expect(await runCase(testCase)).toMatchObject({
      status: 400,
      error: expect.stringMatching(/names no "appLoc" for it/)
    })
  })
})

describe('an app detail answer', () => {
  it('refuses an anonymous caller before revealing an app', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-published'
    ) as CorpusCase
    const result = await runCase({
      ...testCase,
      request: { params: testCase.request.params }
    })
    expect(result.status).toBe(401)
  })

  it('conceals the app from a signed-in caller without a stream grant', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-published'
    ) as CorpusCase
    const result = await runCase({
      ...testCase,
      request: {
        ...testCase.request,
        subject: { userId: 'user-restricted', clientId: 'web_app' }
      }
    })
    expect({ status: result.status, error: result.error }).toEqual({
      status: 404,
      error: 'No App Stream is registered with that id.'
    })
  })

  it('refuses an inactive subject before looking up an unknown app', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-unknown-id'
    ) as CorpusCase
    const result = await runCase({
      ...testCase,
      identity: {
        ...DEFAULT_IDENTITY,
        users: DEFAULT_IDENTITY.users.map((user) =>
          user.uid === 'user-restricted' ? { ...user, isActive: false } : user
        )
      },
      request: {
        ...testCase.request,
        subject: { userId: 'user-restricted', clientId: 'web_app' }
      }
    })
    expect(result.status).toBe(401)
  })

  it('lets a legacy name rule grant access without an inventory entry', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-published'
    ) as CorpusCase
    const result = await runCase({
      ...testCase,
      identity: {
        ...DEFAULT_IDENTITY,
        permissions: [
          {
            uid: 'name-grant',
            path: `/AppStream/${CORPUS_APP.name}`,
            type: 'Route',
            setting: 'Grant',
            user: 'user-restricted'
          }
        ]
      },
      request: {
        ...testCase.request,
        subject: { userId: 'user-restricted', clientId: 'web_app' }
      }
    })
    expect(result.status).toBe(200)
  })

  it('ignores a non-route app grant and conceals its details', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-published'
    ) as CorpusCase
    const restrictedCase = {
      ...testCase,
      identity: {
        ...DEFAULT_IDENTITY,
        permissions: [
          {
            uid: 'other-grant',
            type: 'Other',
            path: `/AppStream/${CORPUS_APP.id}`,
            setting: 'Grant',
            user: 'user-restricted'
          }
        ]
      },
      request: {
        ...testCase.request,
        subject: { userId: 'user-restricted', clientId: 'web_app' }
      }
    }
    const host = servicesFor(restrictedCase)
    const tree = jest.spyOn(host.drive!, 'tree')
    expect((await runCase(restrictedCase, host)).status).toBe(404)
    expect(tree).not.toHaveBeenCalled()
  })

  it('ignores a non-route id deny when selecting a route name grant', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-published'
    ) as CorpusCase
    const result = await runCase({
      ...testCase,
      identity: {
        ...DEFAULT_IDENTITY,
        permissions: [
          {
            uid: 'other-deny',
            type: 'Other',
            path: `/AppStream/${CORPUS_APP.id}`,
            setting: 'Deny',
            user: 'user-restricted'
          },
          {
            uid: 'route-name-grant',
            type: 'Route',
            path: `/AppStream/${CORPUS_APP.name}`,
            setting: 'Grant',
            user: 'user-restricted'
          }
        ]
      },
      request: {
        ...testCase.request,
        subject: { userId: 'user-restricted', clientId: 'web_app' }
      }
    })
    expect(result.status).toBe(200)
  })

  it.each([
    [
      'id grant',
      [{ path: `/AppStream/${CORPUS_APP.id}`, setting: 'Grant' }],
      200
    ],
    ['stream grant', [{ path: '/AppStream', setting: 'Grant' }], 200],
    [
      'id deny overrides name grant',
      [
        { path: `/AppStream/${CORPUS_APP.id}`, setting: 'Deny' },
        { path: `/AppStream/${CORPUS_APP.name}`, setting: 'Grant' }
      ],
      404
    ],
    [
      'id grant overrides name deny',
      [
        { path: `/AppStream/${CORPUS_APP.id}`, setting: 'Grant' },
        { path: `/AppStream/${CORPUS_APP.name}`, setting: 'Deny' }
      ],
      200
    ],
    [
      'id group deny overrides stream group grant',
      [
        { path: `/AppStream/${CORPUS_APP.id}`, setting: 'Deny', group: true },
        { path: '/AppStream', setting: 'Grant', group: true }
      ],
      404
    ]
  ])('uses the server rule precedence: %s', async (_label, rules, status) => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-published'
    ) as CorpusCase
    const result = await runCase({
      ...testCase,
      identity: {
        ...DEFAULT_IDENTITY,
        permissions: rules.map((rule, i) => ({
          uid: `test-${i}`,
          type: 'Route',
          path: rule.path,
          setting: rule.setting,
          ...('group' in rule && rule.group
            ? { group: 'group-data-controller' }
            : { user: 'user-restricted' })
        }))
      },
      request: {
        ...testCase.request,
        subject: { userId: 'user-restricted', clientId: 'web_app' }
      }
    })
    expect(result.status).toBe(status)
  })

  it('preserves desktop access with no identity services', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-published'
    ) as CorpusCase
    const host = servicesFor(testCase)
    const result = await runCase(
      { ...testCase, request: { params: testCase.request.params } },
      { drive: host.drive, appStream: host.appStream }
    )
    expect(result.status).toBe(200)
  })

  it('fails closed for a subject when the host has no record service', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-published'
    ) as CorpusCase
    const host = servicesFor(testCase)
    const result = await runCase(testCase, {
      drive: host.drive,
      appStream: host.appStream
    })
    expect(result.status).toBe(501)
  })

  it('fails closed for identity without a record service', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-published'
    ) as CorpusCase
    const host = servicesFor(testCase)
    const result = await runCase(testCase, {
      drive: host.drive,
      appStream: host.appStream,
      identity: host.identity
    })
    expect(result.status).toBe(501)
  })

  it('does not use public AppStream grants to authenticate anonymous detail requests', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-published'
    ) as CorpusCase
    const result = await runCase({
      ...testCase,
      identity: {
        ...DEFAULT_IDENTITY,
        groups: [
          ...DEFAULT_IDENTITY.groups,
          {
            uid: 'public-group',
            name: 'public',
            description: '',
            isActive: true,
            users: []
          }
        ],
        permissions: [
          {
            uid: 'public-grant',
            type: 'Route',
            path: `/AppStream/${CORPUS_APP.id}`,
            setting: 'Grant',
            group: 'public-group'
          }
        ]
      },
      request: { params: testCase.request.params }
    })
    expect(result.status).toBe(401)
  })

  it('authenticates a valid token for an administrator', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-published'
    ) as CorpusCase
    const result = await runCase({
      ...testCase,
      identity: {
        ...DEFAULT_IDENTITY,
        tokens: [
          {
            username: 'sasjsadmin',
            clientId: 'web_app',
            accessToken: 'detail-access',
            refreshToken: 'detail-refresh'
          }
        ]
      },
      request: { params: testCase.request.params, token: 'detail-access' }
    })
    expect(result.status).toBe(200)
  })

  it('refuses an invalid token', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-published'
    ) as CorpusCase
    const result = await runCase({
      ...testCase,
      request: { params: testCase.request.params, token: 'not-valid' }
    })
    expect(result.status).toBe(401)
  })

  it('does not read drive details for a denied app', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-denied'
    ) as CorpusCase
    const host = servicesFor(testCase)
    const tree = jest.spyOn(host.drive!, 'tree')
    expect((await runCase(testCase, host)).status).toBe(404)
    expect(tree).not.toHaveBeenCalled()
  })

  it('requires a subject from a records-only host', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-published'
    ) as CorpusCase
    const host = servicesFor(testCase)
    const result = await runCase(
      { ...testCase, request: { params: testCase.request.params } },
      { drive: host.drive, appStream: host.appStream, records: host.records }
    )
    expect(result.status).toBe(501)
  })

  it('omits a field the entry does not carry, rather than answering undefined', async () => {
    const testCase = APP_CORPUS.find(
      (candidate) => candidate.id === 'app-detail-frontend'
    ) as CorpusCase

    const result = await runCase(testCase)
    const body = result.body as Record<string, unknown>

    // the entry names no backend, so neither field is present: a client reading
    // `appLoc` gets a missing key, not the string "undefined"
    expect(body.frontendFolder).toBe('/apps/frontend-only')
    expect('appLoc' in body).toBe(false)
    expect('streamWebFolder' in body).toBe(false)
  })
})
