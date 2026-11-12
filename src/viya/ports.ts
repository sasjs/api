/**
 * The ports the emulated handlers read, in one place.
 *
 * `drive` is required on `Services`, so there is no absent case to answer: a host
 * that mounts the emulator has one, and a `501` for a missing drive would be a
 * branch nothing can reach. It lives here rather than in a handler module because
 * two of them read it, and importing one handler map from the other is a cycle.
 */
import type { Services } from '../host/dispatch.js'
import type { DriveService } from '../drive/service.js'

export const requireDrive = (services: Services): DriveService => services.drive
