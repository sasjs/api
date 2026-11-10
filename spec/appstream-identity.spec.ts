import { isAppId, newAppId, normaliseAppLoc } from '../src/appstream/identity'

/** Runs with `globalThis.crypto` replaced, and puts it back however the run ends. */
const withCrypto = (value: unknown, run: () => void) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

  Object.defineProperty(globalThis, 'crypto', {
    value,
    configurable: true,
    writable: true
  })

  try {
    run()
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original)
    else delete (globalThis as { crypto?: unknown }).crypto
  }
}

describe('app location', () => {
  it('normalises spelling that cannot mean a different folder', () => {
    const canonical = '/Public/apps/mario'

    for (const spelling of [
      '/Public/apps/mario/',
      '//Public//apps//mario',
      'Public/apps/mario',
      '/Public/apps/x/../mario',
      '/Public/apps/mario/.'
    ]) {
      expect(normaliseAppLoc(spelling)).toBe(canonical)
    }
  })

  it('leaves the path free to be whatever the drive allows', () => {
    // nothing restricts the charset any more: the id is not derived from the path,
    // so a capital or a space is a folder name rather than an identity problem
    for (const allowed of [
      '/Public/apps/Mario',
      '/Public/apps/my app',
      '/Public/apps/my-app_v2'
    ]) {
      expect(normaliseAppLoc(allowed)).toBe(allowed)
    }
  })

  it('refuses a location that is not a string, rather than using the root', () => {
    for (const invalid of [undefined, null, 0, ''] as any[]) {
      expect(() => normaliseAppLoc(invalid)).toThrow(/non-empty string/)
    }
  })

  it('refuses a location that climbs out of the drive', () => {
    expect(() => normaliseAppLoc('/..')).toThrow(
      'appLoc cannot be outside drive.'
    )
    expect(() => normaliseAppLoc('/Public/../..')).toThrow(
      'appLoc cannot be outside drive.'
    )
  })

  it('keeps the root as the root', () => {
    expect(normaliseAppLoc('/')).toBe('/')
  })
})

describe('app id', () => {
  it('is a version 4 uuid', () => {
    expect(newAppId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newAppId()))

    expect(ids.size).toBe(500)
  })

  it('builds the same uuid from getRandomValues where randomUUID is absent', () => {
    // an older worker, or a host whose crypto is a different shape: the id must
    // still be a version 4 UUID, and must not quietly become a weaker one
    withCrypto(
      {
        getRandomValues: (bytes: Uint8Array) => {
          bytes.fill(0xab)
          return bytes
        }
      },
      () => {
        expect(newAppId()).toBe('abababab-abab-4bab-abab-abababababab')
      }
    )
  })

  it('refuses to mint an id with no cryptographic source at all', () => {
    for (const value of [undefined, {}, { getRandomValues: 1 }])
      withCrypto(value, () =>
        expect(() => newAppId()).toThrow(
          'No cryptographic source of randomness is available.'
        )
      )
  })

  it('accepts only a uuid as an id', () => {
    expect(isAppId(newAppId())).toBe(true)
    // upper case is a value no lookup can find, because every comparison is
    // exact, so the guard must not vouch for one
    expect(isAppId('CB83519E-3EA6-4575-8F71-62173E0467B4')).toBe(false)
    expect(isAppId('3f9')).toBe(false)
    expect(isAppId('67892ccb')).toBe(false)
    expect(isAppId(5)).toBe(false)
    expect(isAppId('not-a-uuid-at-all')).toBe(false)
  })
})
