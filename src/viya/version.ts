/**
 * The one Viya version this emulator emulates, and the header that says so.
 *
 * Decision 6 of sasjs/server#665: the contract is pinned to one version, and
 * every answer names it. The pin is not a preference - it is the version the
 * capture was taken against, recorded with the date of that capture, so a reader
 * can see how old the contract is. Raising it moves the table, the corpus, the
 * drift baseline and this header in one commit, justified by a fresh capture.
 *
 * The value is `sysvlong` as SAS reported it in a compute session on the estate:
 *
 *     %put &=sysvlong;   ->   V.04.00M0P100526
 */
export const VIYA_TARGET_VERSION = 'V.04.00M0P100526'

/** The day the capture that pins this version was taken. */
export const VIYA_CAPTURED_AT = '2026-11-12'

/** The header every emulated answer carries, including refusals and 404s. */
export const EMULATED_HEADER = 'x-sasjs-emulated'

/**
 * `viya@<version>`: one header, one fact.
 *
 * Decision 12 asked whether a second header should separate the version from the
 * mode. It should not - a reader who sees this header knows both what answered
 * and which contract it answered against, and a machine that keys on the value
 * cannot mistake an emulated answer for a real one.
 */
export const EMULATED_HEADER_VALUE = `viya@${VIYA_TARGET_VERSION}`

/**
 * The headers an emulated answer carries.
 *
 * `Access-Control-Expose-Headers` is not decoration: the browser reads a
 * response's headers across an origin only when the server names them, so
 * without it the one header that makes emulation unmistakable is the one a
 * cross-origin client cannot see.
 */
export const emulatedHeaders = (): Record<string, string> => ({
  [EMULATED_HEADER]: EMULATED_HEADER_VALUE,
  'Access-Control-Expose-Headers': EMULATED_HEADER
})
