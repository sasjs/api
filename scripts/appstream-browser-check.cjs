// Proves the app stream runs from the shipped browser bundle - the one a mock
// site loads with importScripts - not just from the TypeScript source.
const fs = require('fs')
const vm = require('vm')
const path = require('path')

const bundle = fs.readFileSync(
  path.join(__dirname, '..', 'build/browser.js'),
  'utf8'
)

const { webcrypto } = require('crypto')

/** A worker as the package expects it: `self`, and webcrypto on the global. */
const load = (crypto) => {
  const self = {}
  const context = vm.createContext({
    self,
    console,
    Uint8Array,
    TextEncoder,
    crypto
  })

  vm.runInContext(bundle, context)

  return self.SASjsApi
}

const API = load(webcrypto)

const required = [
  'createAppStreamService',
  'createAppStreamWebService',
  'MemoryAppStreamStore',
  'splitAppBundle',
  'appSummary',
  'createDriveService',
  'MemoryDriveStore',
  'dispatch'
]

const missing = required.filter((name) => typeof API[name] !== 'function')

if (missing.length) {
  console.error('browser bundle is missing:', missing.join(', '))
  process.exit(1)
}

const manifest = JSON.stringify({
  name: 'Mario',
  streamWebFolder: 'web',
  logo: 'logo.png'
})

const tree = {
  members: [
    { name: 'sasjs.app.json', type: 'file', code: manifest },
    {
      name: 'services',
      type: 'folder',
      members: [
        {
          name: 'web',
          type: 'folder',
          members: [
            { name: 'index.html', type: 'file', code: '<h1>Mario</h1>' },
            { name: 'main.abcdef12.js', type: 'file', code: 'console.log(1)' }
          ]
        },
        { name: 'run', type: 'service', code: '%put hi;' }
      ]
    }
  ]
}

/**
 * An older worker has `getRandomValues` and no `randomUUID`. The id must still be
 * a version 4 UUID rather than something weaker or absent.
 */
const fallback = () => {
  const older = load({
    getRandomValues: (bytes) => webcrypto.getRandomValues(bytes)
  })

  const apps = older.createAppStreamService(new older.MemoryAppStreamStore())

  return apps
    .publish({ appLoc: '/Public/apps/older', streamWebFolder: 'web' })
    .then((app) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        app.id
      )
    )
}

const main = async () => {
  const appStream = API.createAppStreamService(new API.MemoryAppStreamStore())
  const drive = API.createDriveService(new API.MemoryDriveStore({}))
  const surface = API.createAppStreamWebService(appStream, drive)

  const deployed = await API.dispatch(
    { drive, appStream },
    'POST /SASjsApi/drive/deploy',
    { body: { appLoc: '/Public/apps/mario', fileTree: tree } }
  )

  const app = deployed.body.app

  const index = await surface.request({ method: 'GET', path: app.url })
  const script = await surface.request({
    method: 'GET',
    path: `${app.url}main.abcdef12.js`
  })
  const listing = await surface.apps()

  const checks = [
    ['deploy indexes the app', deployed.status === 200 && !!app.id],
    ['url is the id', app.url === `/app/${app.id}/`],
    ['a v4 uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(app.id)],
    ['index.html is served', index.status === 200 && index.body === '<h1>Mario</h1>'],
    ['hashed asset is cached hard', /immutable/.test(script.headers['cache-control'])],
    ['the listing carries the id', listing.apps[0] && listing.apps[0].id === app.id],
    ['the manifest is not deployed', !(await drive.read('/Public/apps/mario/sasjs.app.json').then(() => true, () => false))],
    ['the services are deployed', (await drive.read('/Public/apps/mario/services/run.sas')).contents === '%put hi;'],
    ['mints a v4 uuid with no randomUUID', await fallback()]
  ]

  let failed = 0

  for (const [name, ok] of checks) {
    console.log(`${ok ? 'ok' : 'FAIL'} - ${name}`)
    if (!ok) failed++
  }

  if (failed) {
    console.error(`\n${failed} check(s) failed`)
    process.exit(1)
  }

  console.log(`\nbrowser bundle: app ${app.id} deployed, indexed and served`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
