# @sasjs/api

The SASjs Server API, described once: a route table generated from `sasjs/server`'s published OpenAPI document, the services behind those routes, and a conformance corpus that both the server and the browser build run.

It exists because the API was implemented twice.
`sasjs/server` answers `/SASjsApi/*` from Express controllers, and the browser build in `sasjs/cli` (`sasjs build` with `streamConfig.mockWeb`) answers the same paths from a service worker.
Two implementations drift: the `webout()` envelope and the session header seed were both found answering differently on the two hosts (`sasjs/cli#1540`, `sasjs/cli#1542`), and neither was caught by a test.
The plan that this package implements is tracked in `sasjs/cli#1550`.

## What is in it

**The route table** (`ROUTES`, `findRoute`) is every operation in the API - 43 paths, 60 operations - derived from `spec/swagger.yaml` by `npm run sync:routes`.
The document cannot say everything a host needs, so a reviewed overlay adds the body each response carries, the capability a route needs, and whether this package implements it.
Where `sasjs/server`'s document and its implementation disagree, the overlay records the disagreement and follows the implementation, because the implementation is what a client sees.

**The services** (`createDriveService`) are the API's decisions over storage the host supplies: the statuses, the messages, the order of the checks, and the path rules (including `resolveWithinDrive`'s containment).
They are `async`, take a `DriveStore`, and import nothing - so the same code runs under Express and inside a service worker.

**The corpus** (`DRIVE_CORPUS`, `runCase`) is what "the same API" means when a test has to check it: each case is a request, the answer a client expects, and the files it starts from.
The same cases are meant to run against a live server and against the browser build, so a difference fails a test rather than waiting for a reviewer to notice.

## Using it

```bash
npm install @sasjs/api
```

Requires Node `^22.14.0 || >=24.10.0` - the floor the release toolchain needs, and what CI runs.

A host supplies a store and, later, an identity.
In node:

```ts
import { createDriveService, ROUTES, findRoute } from '@sasjs/api'

const drive = createDriveService(nodeDriveStore) // your fs, behind the port
const match = findRoute('POST', '/SASjsApi/drive/file')
```

In a service worker - the browser build's case - load the bundle the package ships and read it off `self`:

```js
importScripts('/host/sasjs-api.js') // build/browser.js, copied by your build
const { createDriveService, findRoute } = self.SASjsApi
```

The bundle is deliberately a classic-worker IIFE: a service worker registered by a static site has `importScripts` and no module loader, and the consumer copies its assets verbatim rather than running a bundler of its own. Bundling belongs here, once.

Both hosts answer with the same shapes:

- a successful write is `{ status: 'success' }`;
- a refusal is an `ApiError` carrying `status` and `message`, which a host renders as its own transport requires (`res.status(code).send(...)` on the server, a `Response` in the worker);
- an operation this package has no handler for is `501`, naming the operation - not a `404` that looks like a typo in the caller;
- an operation the API does not have is `404`.

## Guarantees the build enforces

- **No runtime imports.** `src` compiles with `"types": []` and `lib: ES2020`, so a `Buffer`, a `process` or a `document` reference fails `npm run build` rather than a worker at run time. Nothing node-shaped can creep into the browser path.
- **No Node-only APIs in the published surface.** Storage is a port (`DriveStore`), and `MemoryDriveStore` ships so a host without a filesystem has an implementation to use.
- **Three builds from one source.** `build/cjs` for node, `build/esm` for a bundler (with `build/esm` marked `"type": "module"` by the build script so Node runs it as ESM), and `build/browser.js` - a classic-worker IIFE that assigns `self.SASjsApi` - for a service worker that has only `importScripts`. CI loads all three.
- **The table cannot rot silently.** `npm run check:routes` fails when `src/routes/generated.ts` and `spec/swagger.yaml` disagree, and the module throws at import when an overlay entry names an operation the document does not have.

## Status

Implemented: the nine drive handlers (file read/write/replace/delete, folder read/create/delete, rename, file tree), exercised by 27 corpus cases.
Not implemented yet, in the order the plan sets: identity (`auth`, `user`, `group`, `permission`, and the `SASLogon` sign-in flow), the session record, program execution (`stp`, `code`), `drive/deploy` and its size cap, and the admin routes.
`src/routes/overlay.ts` is the list: an operation with `implemented: true` has a handler, and everything else answers `501` with its own name.

## Development

```bash
npm ci
npm test              # jest with a coverage floor
npm run build         # dual build + the ESM package marker
npm run check:routes  # the generated table matches spec/swagger.yaml
npm run lint
```

Refreshing the API surface: regenerate `api/public/swagger.yaml` in `sasjs/server` (`npm run swagger`), copy it to `spec/swagger.yaml`, and run `npm run sync:routes`. Review the diff - a new operation needs an overlay entry before a host can say whether it implements it.

## Licence

MIT. See `LICENCE.md`.
