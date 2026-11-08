# @sasjs/api

The SASjs Server API, described once: a route table generated from `sasjs/server`'s published OpenAPI document, the services behind those routes, and a conformance corpus that both the server and the browser build run.

It exists because the API was implemented twice.
`sasjs/server` answers `/SASjsApi/*` from Express controllers, and the browser build in `sasjs/cli` (`sasjs build` with `streamConfig.mockWeb`) answers the same paths from a service worker.
Two implementations drift: the `webout()` envelope and the session header seed were both found answering differently on the two hosts (`sasjs/cli#1540`, `sasjs/cli#1542`), and neither was caught by a test.
The plan that this package implements is tracked in `sasjs/cli#1550`.

## What is in it

**The route table** (`ROUTES`, `findRoute`) is every operation in the API, derived from `spec/swagger.yaml` by `npm run sync:routes`.
The statuses come from that document and nowhere else: the overlay cannot add one, and an overlay entry naming a status the document does not state fails the build rather than describing a wish.
The document cannot say everything a host needs, so the reviewed overlay adds the body each response carries, the capability a route needs, and the decision for the operation: `implemented: true`, or `implemented: false` with the reason it is not.
Every operation has an entry - the table refuses one that does not, so "nobody has looked at this yet" cannot hide as silence - and a host asked for an unimplemented route answers `501` carrying that reason.
Where the document is wrong, it is corrected in `sasjs/server` and re-vendored here - never worked around in the overlay.

### Regenerating the vendored document

`spec/swagger.yaml` is generated from the controllers in `sasjs/server`. In a checkout of that repository run `npm run swagger` (tsoa), copy `api/public/swagger.yaml` over `spec/swagger.yaml` keeping the header at the top of the file, then run `npm run sync:routes` here. `npm run check:routes` fails if `src/routes/generated.ts` no longer matches the document.

**The services** (`createDriveService`, `createIdentityService`, `createRecordService`, `createSessionService`, `createRuntimeService`, `createInfoService`, `createAuthConfigService`, `createAdminService`, `createDirectoryService`, `createHomeService`) are the API's decisions over storage the host supplies: the statuses, the messages, the order of the checks, and the path rules (including `resolveWithinDrive`'s containment).
`createRecordService` is the administration surface - users, groups, permission rules and clients - over the same `IdentityStore`, including the admin gate (`401 Admin account required`) and the self-or-admin rule the server applies in middleware.
`createSessionService` reads a triggered session's record, log, output and state, and `createRuntimeService` runs a program or starts one: the package decides the request, the session id, the record, its owner and its retention, and a host's `SessionRunner` performs the work - which is why a mock can answer these routes, and can even finish a session.
`createInfoService` answers `GET /info` from the host's own configuration (`BROWSER_INFO` is the browser host's answer), and `createAuthConfigService` renders the enabled providers with the secrets reduced to the two `*_SET` booleans - a host that passes a secret-shaped field is refused by name rather than served.
`createAdminService` carries the three Admin reports over the host's `AdminReports`, owning the diagnostics shape, the log-name rule and the `lines` bounds; `createDirectoryService` imports a directory over a five-method `DirectoryStore`, creating what is missing and leaving what exists; `createHomeService` stamps the interface's shell with a token derived from its bundle, so a cached page cannot pin an old build.
They are `async`, take a `DriveStore`, and import nothing - so the same code runs under Express and inside a service worker.

**The corpus** (`DRIVE_CORPUS`, `DEPLOY_CORPUS`, `CODE_CORPUS`, `IDENTITY_CORPUS`, `RECORD_CORPUS`, `SESSION_CORPUS`, `RUNTIME_CORPUS`, `INFO_CORPUS`, `ADMIN_CORPUS`, `AUTH_CONFIG_CORPUS`, `DIRECTORY_CORPUS`, `HOME_CORPUS`, `runCase`) is what "the same API" means when a test has to check it: each case is a request, the answer a client expects, and the files it starts from.
The same cases are meant to run against a live server and against the browser build, so a difference fails a test rather than waiting for a reviewer to notice.

## Using it

```bash
npm install @sasjs/api
```

Requires Node `^22.14.0 || >=24.10.0` - the floor the release toolchain needs, and what CI runs.

A host supplies a store and, for the sign-in routes, an identity. `memory-store.ts` ships both memory implementations, so a host with no filesystem and no database has something to start from:

```ts
import {
  createDriveService,
  createIdentityService,
  MemoryIdentityStore,
  ROUTES,
  findRoute
} from '@sasjs/api'

const drive = createDriveService(nodeDriveStore) // your fs, behind the port
const identity = createIdentityService(nodeIdentityStore) // your users, tokens
const match = findRoute('POST', '/SASjsApi/drive/file')
```

An `IdentityStore` is users, clients, token pairs and auth codes, plus the cryptography that names a subject in a token: a server signs JWTs it later verifies against the same secret, a browser build mints opaque strings it can look up. Splitting those two halves would let a host pair one host's minting with another's verification, so they are one port.

`MemoryIdentityStore` is a host's identity with no database behind it: it is what a mock build uses, and it is not an identity service. It holds the demo passwords in clear and issues opaque tokens that nothing signs, so every page that shows it says so - a site holding anything real belongs behind a server, not a fixture.

`IDENTITY_FORMAT`, `parseIdentity` and `DEFAULT_IDENTITY` describe the fixture a browser build ships - one administrator, one restricted user, two groups, a handful of permission rules and a client - so a mock works with no configuration. `parseIdentity` refuses a fixture it cannot read, by name: another format, a missing collection, no administrator, or a seeded token with only half a pair.

In a service worker - the browser build's case - load the bundle the package ships and read it off `self`:

```js
importScripts('/host/sasjs-api.js') // build/browser.js, copied by your build
const { createDriveService, findRoute } = self.SASjsApi
```

The bundle is deliberately a classic-worker IIFE: a service worker registered by a static site has `importScripts` and no module loader, and the consumer copies its assets verbatim rather than running a bundler of its own. Bundling belongs here, once.

Both hosts answer with the same shapes:

- a successful write is `{ status: 'success' }`;
- a refusal is an `ApiError` carrying `status`, `message` and, where the route answers an envelope rather than text, the `body` to send instead of the bare message - which a host renders as its own transport requires (`res.status(code).send(...)` on the server, a `Response` in the worker);
- an operation this package has no handler for is `501`, naming the operation and the reason it is not implemented here - not a `404` that looks like a typo in the caller;
- an operation the API does not have is `404`.

## Guarantees the build enforces

- **No runtime imports.** `src` compiles with `"types": []` and `lib: ES2020`, so a `Buffer`, a `process` or a `document` reference fails `npm run build` rather than a worker at run time. Nothing node-shaped can creep into the browser path.
- **No Node-only APIs in the published surface.** Storage is a port (`DriveStore`), and `MemoryDriveStore` ships so a host without a filesystem has an implementation to use.
- **Three builds from one source.** `build/cjs` for node, `build/esm` for a bundler (with `build/esm` marked `"type": "module"` by the build script so Node runs it as ESM), and `build/browser.js` - a classic-worker IIFE that assigns `self.SASjsApi` - for a service worker that has only `importScripts`. CI loads all three.
- **The table cannot rot silently.** `npm run check:routes` fails when `src/routes/generated.ts` and `spec/swagger.yaml` disagree, and the module throws at import when an overlay entry names an operation the document does not have, or when an operation has no entry at all.

## Status

`src/routes/overlay.ts` is the status, and the table refuses an operation that is not in it: each entry is `implemented: true` - the package answers the route - or `implemented: false` with the dependency it waits on.
`ROUTES.filter((route) => !route.implemented)` is therefore the list of what is left, each row naming the port, host decision or plan it is waiting for; a host asked for one answers `501` with that reason.

Every implemented operation is exercised by the corpus, and a handler without a case fails `spec/corpus-parity.spec.ts` - so "implemented" and "proven against the contract" are the same list rather than two that drift.

A status the document states but only a host can send - an account lockout (`429`), a provider failure (`500`), a session-store failure - is marked `hostResponses` in the overlay. It stays in the document, because a client still receives it, and is excluded from the parity check, whose other side is what this package answers; the host's own suite pins it.

## What a host must do

Three of the sign-in flow's defences are the host's, because the package has no request to read and no clock to trust:

- **Re-resolve the caller on every request.** A host with its own session passes the subject in (`session`, `authorize`), so the service re-reads the account behind it and refuses a deactivated one; a host that caches the subject it resolved at sign-in defeats that check. `logout` is the exception and does not refuse: dropping a credential is not access, and refusing would leave the pair in the store.
- **Lock the account out after repeated failures.** `POST /SASLogon/login` answers `401 Username is not found.` for an unknown username and `401 Invalid Password.` for a wrong one, because that is what the server's own form tells a user - which also means the route cannot tell a caller to stop guessing on its own. The defence is the host's limiter, answering `429` with `Retry-After` in seconds; without it the route is a way to enumerate usernames and account state.
- **Answer a session-store or identity-provider failure with `500`.** Those are the host's own dependencies, and the overlay marks the statuses as `hostResponses`.
- **Admit `DEPLOY_PAYLOAD_BYTES` on the deploy route, and only there.** The deploy cap is stated in decoded bytes and its tree travels as JSON in which file contents are base64, so a tree at the cap reaches the parser at up to ~134 MB; a smaller body limit refuses first, with its own shape, and the cap is never consulted. Every other route keeps the smaller limit, because a body is buffered before authentication.

## Development

```bash
npm ci
npm test              # jest with a coverage floor
npm run build         # dual build + the ESM package marker
npm run check:routes  # the generated table matches spec/swagger.yaml
npm run lint
```

Refreshing the API surface: regenerate `api/public/swagger.yaml` in `sasjs/server` (`npm run swagger`), copy it to `spec/swagger.yaml`, and run `npm run sync:routes`. Review the diff: a new operation needs an overlay entry, and the table refuses to build without one.

Re-vendoring is a two-repository change and the server half merges first: the document is only true once the controllers it is generated from answer what it states, so a copy taken from an unmerged server branch describes a server that does not exist yet. Take the copy from a released tag of `sasjs/server` rather than from its `main`, and the document and the code a host runs cannot disagree.

### The coverage ratchet

`jest.config.js` carries a floor, and a floor only moves when somebody remembers to move it - so it passes a pull request that drops two points as long as it stays above the number. The ratchet is the other half:

- `.github/workflows/coverage-baseline.yml` publishes `coverage/coverage-summary.json` for every push to `main` (90-day artifact);
- a pull request downloads the summary published for its base commit - or for the newest commit the base commit descends from, named in the comment - and `.github/scripts/coverage-ratchet.mjs` fails when any of statements / branches / functions / lines is more than 0.05pt below it;
- the same comparison is appended to the coverage comment, so "did this go backwards" is answered on the pull request rather than inferred from a total.

A deliberate drop is a change to `coverageThreshold` in `jest.config.js` in that same pull request, where a reviewer sees it. The script's own cases run with `node --test .github/scripts/coverage-ratchet.test.mjs`; prove it locally by pointing `--head` and `--base` at the same summary (exit 0) and then at a copy with its totals raised a point (exit 1).

## Licence

MIT. See `LICENCE.md`.
