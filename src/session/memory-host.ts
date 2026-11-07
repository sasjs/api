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
      expiresAfterMins: 60
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
  'sess-admin': { state: 'completed', pid: 4242, lineCount: 12 },
  'sess-restricted': { state: 'running', pid: 4243, lineCount: 3 }
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

export class MemorySessionHost implements SessionHost {
  constructor(private readonly sessions = DEFAULT_SESSIONS) {}

  async session(id: string) {
    return this.sessions[id]
  }

  async state(id: string): Promise<SessionStateResponse | undefined> {
    return STATES[id]
  }

  async log(id: string): Promise<string | undefined> {
    return LOGS[id]
  }

  async output(id: string): Promise<SessionArtifact | undefined> {
    return OUTPUTS[id]
  }
}
