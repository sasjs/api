/**
 * The index kept as a file on the drive.
 *
 * A host that has a drive and no other place to put the index can use this: the
 * browser build does, where the drive is the only durable thing there is, and the
 * file rides along with the persistence the drive already has.
 *
 * An absent file is an empty index - the state a host starts in. A file that is
 * not an index is an error rather than an empty index: a deploy that silently
 * unregistered every app because the file had a trailing comma is the failure
 * this refuses to hide.
 */
import { ApiError } from '../types.js'
import type { DriveService } from '../drive/service.js'
import type { AppStreamEntry, AppStreamStore } from './service.js'

/** Where the index lives when a host does not choose: hidden, and not an app's. */
export const APP_STREAM_INDEX = '/.sasjs/apps.json'

const isEntry = (value: unknown): value is AppStreamEntry => {
  if (typeof value !== 'object' || value === null) return false

  const entry = value as Record<string, unknown>

  return (
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.appLoc === 'string' &&
    typeof entry.streamWebFolder === 'string' &&
    typeof entry.publishedAt === 'string'
  )
}

export const createDriveAppStreamStore = (
  drive: DriveService,
  filePath: string = APP_STREAM_INDEX
): AppStreamStore => ({
  async read() {
    let contents: string | Uint8Array

    try {
      contents = (await drive.read(filePath)).contents
    } catch (error) {
      // nothing published yet is not an error, it is the empty case
      if (error instanceof ApiError && error.status === 404) return []

      throw error
    }

    if (typeof contents !== 'string')
      throw new ApiError(
        500,
        `The app index at ${filePath} is not text, so no app can be read from it.`
      )

    let parsed: unknown

    try {
      parsed = JSON.parse(contents)
    } catch (error) {
      throw new ApiError(
        500,
        `The app index at ${filePath} is not valid JSON, so no app is registered: ${(error as Error).message}`
      )
    }

    if (!Array.isArray(parsed) || !parsed.every(isEntry))
      throw new ApiError(
        500,
        `The app index at ${filePath} is not a list of app entries, so no app is registered.`
      )

    return parsed
  },

  async write(entries) {
    const contents = JSON.stringify(entries, null, 2)

    try {
      await drive.update(filePath, contents)
    } catch (error) {
      // the first publish creates the index; every one after it replaces it
      if (error instanceof ApiError && error.status === 404) {
        await drive.save(filePath, contents)
        return
      }

      throw error
    }
  }
})
