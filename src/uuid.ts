/**
 * A UUID v4 for Node and browser workers. Where `randomUUID` is unavailable,
 * build it from `getRandomValues`; do not fall back to weaker randomness.
 */
export const newUuidV4 = (): string => {
  const webCrypto = (
    globalThis as {
      crypto?: {
        randomUUID?: () => string
        getRandomValues?: (bytes: Uint8Array) => Uint8Array
      }
    }
  ).crypto

  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()

  if (typeof webCrypto?.getRandomValues !== 'function')
    throw new Error('No cryptographic source of randomness is available.')

  const bytes = new Uint8Array(16)

  webCrypto.getRandomValues(bytes)

  // version 4, variant 10xx
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-')
}
