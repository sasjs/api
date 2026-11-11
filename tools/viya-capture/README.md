# Viya capture

Records what `@sasjs/adapter` sends to a Viya estate and what the estate answers, so the emulator's route table and corpus describe the client that uses them rather than somebody's idea of it.

The adapter is the driver: this script points it at a local proxy, and the proxy forwards every request to the estate and stores the pair. Request and response headers are redacted by name, secret-bearing body values are replaced, and the access token and client secret are scrubbed as literals wherever they appear, so the output file carries no credentials.

## Running it

Node 18 or newer. Three commands, from this directory:

    npm install
    export VIYA_URL=https://your-estate.example.com
    export VIYA_TOKEN=<an access token the estate accepts>
    node capture.mjs

Add these when you have them:

| Variable                               | What it turns on                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `VIYA_CLIENT_ID`, `VIYA_CLIENT_SECRET` | records `/SASLogon/oauth/token` for client credentials, and a deliberate bad-secret refusal |
| `VIYA_REFRESH_TOKEN`                   | records the refresh grant                                                                   |
| `VIYA_CONTEXT`                         | records the compute context lookup by name, and enables the session steps                   |
| `VIYA_APP_LOC`                         | records the folder item and its members                                                     |
| `VIYA_ALLOW_EXECUTE=1`                 | creates a session, reads its state, deletes it                                              |
| `VIYA_ALLOW_WRITES=1`                  | creates and deletes one folder under `VIYA_APP_LOC`                                         |
| `VIYA_TLS_RELAX=1`                     | accepts a self-signed certificate                                                           |
| `CAPTURE_PORT`                         | local proxy port, default 8899                                                              |

The default pass is read-only. `VIYA_ALLOW_EXECUTE` and `VIYA_ALLOW_WRITES` are off unless set, and each one only touches what it creates.

## What it leaves behind

`capture/viya-capture-<timestamp>.json`, and a summary line with the count of requests and the statuses seen. Send the file back; it is safe to share.

A refused call is recorded too: a 401, a 403 or a 400 is as much a part of the contract as a 200, and the emulator has to answer it identically.

## What it does not do

- It does not create, modify or delete anything outside the folder names it generates, and it deletes those.
- It does not need the CLI, a browser, or a project checkout.
- It does not record request or response bodies in full: bodies are capped at 24 KB and are redacted.
