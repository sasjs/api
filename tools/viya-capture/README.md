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

## What leaves the file, and what stops it

Two kinds of fact are removed before anything is written:

- **Credentials.** Header values for `authorization`, `cookie`, `set-cookie` and the CSRF headers are replaced; JSON bodies are walked key by key, so a token nested in a response is replaced wherever it sits; form bodies are redacted by parameter. The access token, client secret and refresh token are also scrubbed as literals, which catches one echoed inside an error message.
- **The environment.** The estate's origin becomes `https://<estate>` and its host becomes `<estate>` wherever they appear - including an absolute link inside a response body - and `VIYA_APP_LOC` becomes `<appLoc>`.

The finished text is then read back and searched for what a scrubber cannot know: the estate host, a token-shaped value, any address other than loopback, and the run's own secrets. If anything is found the file is **not written**: the categories and counts are printed, the script exits 3, and nothing is left on disk. Both directions are exercised - a clean run writes, a stand-in estate answering with an address in a field is refused with `address (1)`.

## What it does not do

- It does not create, modify or delete anything outside the folder names it generates, and it deletes those.
- It does not need the CLI, a browser, or a project checkout.
- It does not record request or response bodies in full: bodies are capped at 24 KB and are redacted.
- It does not commit anything. `capture/` and `node_modules/` are ignored, so a capture is a file to send back, never a file to push.
