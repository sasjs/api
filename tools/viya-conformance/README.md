# Viya conformance

Drives `@sasjs/adapter`'s own client against the emulator over real HTTP.

The adapter's suite mocks axios, so it asserts the responses it was handed rather than the ones a server sends. This is the other half of that picture: an HTTP server answering every Viya path from `dispatchViya`, with `SASViyaApiClient` and `SasjsRequestClient` used unchanged on the client side.

    npm run build
    npm run conformance
    ADAPTER_PATH=/path/to/adapter-with-a-build npm run conformance

`ADAPTER_PATH` defaults to `node_modules/@sasjs/adapter`. The script exits non-zero when a check fails or when the emulator answers a 5xx.

## What it found

Each of these was invisible to both suites before it, and each is now a case in `spec/viyaCompute.spec.ts` or `spec/viyaDispatch.spec.ts` as well:

- the adapter joins a root of `/` to `/app` and sends `//app` - a different path, and therefore a different folder id, so the id it was given answered 404 on the next call;
- a session body carrying only a `self` link fails: the client polls the `rel: 'state'` link and fetches the `rel: 'log'` one, so those rels are the contract;
- a session stamped with a fixed instant is born expired, because the client computes its age against `sessionInactiveTimeout`;
- the program arrives as an array of lines, not a string;
- `/state` answers a bare enum, not `{ state }`, because the client calls `.trim()` on the body.

## What it does not do

It is not the adapter's test suite and does not replace it. It exercises one flow - context, session, folder, job, log - through the paths a `serverType=SASVIYA` build takes, which is enough to catch a body a client cannot read, and not enough to catch a behavioural difference in the adapter itself.
