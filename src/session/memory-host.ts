import type {
  HostSession,
  SessionArtifact,
  SessionHost,
  SessionStateResponse
} from './service.js'

/**
 * The sessions the corpus and the package's own tests read.
 *
 * One session per account, so the interesting case is expressible: an
 * administrator may read a session that is not theirs, and the other way round
 * answers the 404 that hides it. `sess-silent` exists with nothing written yet,
 * because an empty log is a 200 and not a 404.
 */
export const DEFAULT_SESSIONS: Record<string, HostSession> = {
  'sess-admin': {
    owner: 'user-admin',
    summary: {
      sessionId: 'sess-admin',
      state: 'completed',
      pid: 4242,
      creationTimeStamp: '2026-11-07T09:00:00.000Z',
      deathTimeStamp: '2026-11-07T09:00:04.000Z',
      expiresAfterMins: { mins: 60, used: false }
    }
  },
  'sess-restricted': {
    owner: 'user-restricted',
    summary: {
      sessionId: 'sess-restricted',
      state: 'running',
      pid: 4243,
      creationTimeStamp: '2026-11-07T09:05:00.000Z'
    }
  },
  'sess-silent': {
    owner: 'user-admin',
    summary: {
      sessionId: 'sess-silent',
      state: 'running',
      pid: 4244,
      creationTimeStamp: '2026-11-07T09:10:00.000Z'
    }
  }
}

const STATES: Record<string, SessionStateResponse> = {
  // `state` alone: the document's SessionStateResponse allows no other property,
  // and a mock that answered `pid` or a line count would let a case pass here
  // and fail against a server that answers the shape the document states
  'sess-admin': { state: 'completed' },
  'sess-restricted': { state: 'running' }
}

const LOGS: Record<string, string> = {
  'sess-admin': 'NOTE: session started\nNOTE: session completed\n',
  'sess-restricted': 'NOTE: session started\n',
  'sess-silent': ''
}

const OUTPUTS: Record<string, SessionArtifact> = {
  'sess-admin': {
    contents: '<html><body>42</body></html>',
    contentType: 'text/html'
  },
  'sess-restricted': { contents: '' },
  'sess-silent': { contents: '' }
}

/**
 * Sessions held in maps.
 *
 * The four maps are `protected` rather than `private`, because a trigger creates
 * a session and the same object has to be able to record it - a runner that
 * wrote a record into a second map would leave the session routes answering 404
 * for a session that exists.
 */
export class MemorySessionHost implements SessionHost {
  constructor(
    protected readonly sessions: Record<string, HostSession> = {
      ...DEFAULT_SESSIONS
    },
    protected readonly states: Record<string, SessionStateResponse> = {
      ...STATES
    },
    protected readonly logs: Record<string, string> = { ...LOGS },
    protected readonly outputs: Record<string, SessionArtifact> = {
      ...OUTPUTS
    }
  ) {}

  async session(id: string) {
    return this.sessions[id]
  }

  async state(id: string): Promise<SessionStateResponse | undefined> {
    return this.states[id]
  }

  async log(id: string): Promise<string | undefined> {
    return this.logs[id]
  }

  async output(id: string): Promise<SessionArtifact | undefined> {
    return this.outputs[id]
  }
}
