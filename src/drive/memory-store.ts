/**
 * A `DriveStore` over two Maps, for tests and for hosts that have no filesystem.
 *
 * It is deliberately not clever: text is kept as a string, bytes as a copy of
 * the `Uint8Array`, and folders are implied by the paths that exist plus the
 * ones `mkdirp` recorded. That is exactly the model the browser build needs, so
 * a host can use this class as its store rather than writing another one - the
 * browser build already persists the whole drive as a map of path to string.
 */
import type { DriveStore } from '../types.js'
import { ApiError } from '../types.js'
import { dirname } from './paths.js'

type Entry = string | Uint8Array

export class MemoryDriveStore implements DriveStore {
  private files = new Map<string, Entry>()
  private folders = new Set<string>(['/'])
  /**
   * When each entry was first written and last written, ISO strings.
   *
   * A Map has no clock of its own, so the store keeps one: a seeded drive is
   * created when the store is, and a write moves `modified` while `created`
   * stays. A host with real file metadata reports its own instead.
   */
  private times = new Map<string, { created: string; modified: string }>()

  constructor(seed: Record<string, Entry> = {}) {
    for (const [path, contents] of Object.entries(seed)) {
      this.putSync(path, contents)
    }
  }

  /** Everything on the drive, for a snapshot or an assertion. */
  dump(): Record<string, Entry> {
    const out: Record<string, Entry> = {}
    for (const [path, contents] of this.files) out[path] = contents
    return out
  }

  private putSync(path: string, contents: Entry): void {
    this.mkdirpSync(dirname(path))
    this.files.set(
      path,
      typeof contents === 'string' ? contents : contents.slice()
    )

    const now = new Date().toISOString()
    const existing = this.times.get(path)

    this.times.set(path, {
      created: existing?.created ?? now,
      modified: now
    })
  }

  private mkdirpSync(path: string): void {
    const parts = path.split('/').filter(Boolean)
    let acc = ''
    for (const part of parts) {
      acc += '/' + part
      this.folders.add(acc)
    }
  }

  private children(path: string): { files: string[]; folders: string[] } {
    const prefix = path === '/' ? '/' : path + '/'
    const files: string[] = []
    const folders: string[] = []
    for (const candidate of this.files.keys()) {
      if (!candidate.startsWith(prefix)) continue
      const rest = candidate.slice(prefix.length)
      if (rest && !rest.includes('/')) files.push(rest)
    }
    for (const candidate of this.folders) {
      if (!candidate.startsWith(prefix)) continue
      const rest = candidate.slice(prefix.length)
      if (rest && !rest.includes('/')) folders.push(rest)
    }
    return { files: files.sort(), folders: folders.sort() }
  }

  async read(path: string): Promise<Entry> {
    const contents = this.files.get(path)
    if (contents === undefined) throw new ApiError(404, `File doesn't exist.`)
    return contents
  }

  async write(path: string, contents: Entry): Promise<void> {
    this.putSync(path, contents)
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path)
  }

  async stat(path: string): Promise<{
    directory: boolean
    size: number
    modified?: string
    created?: string
  }> {
    if (this.folders.has(path) && !this.files.has(path))
      return { directory: true, size: 0 }

    const contents = this.files.get(path)
    if (contents === undefined) throw new ApiError(404, `File doesn't exist.`)

    const times = this.times.get(path)

    return {
      directory: false,
      size: typeof contents === 'string' ? contents.length : contents.length,
      ...(times ? { modified: times.modified, created: times.created } : {})
    }
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    return this.children(path)
  }

  async mkdirp(path: string): Promise<void> {
    this.mkdirpSync(path)
  }

  async remove(path: string): Promise<void> {
    if (this.files.delete(path)) return
    const prefix = path === '/' ? '/' : path + '/'
    for (const candidate of [...this.files.keys()]) {
      if (candidate.startsWith(prefix)) this.files.delete(candidate)
    }
    for (const candidate of [...this.folders]) {
      if (candidate === path || candidate.startsWith(prefix))
        this.folders.delete(candidate)
    }
  }

  async move(from: string, to: string): Promise<void> {
    const contents = this.files.get(from)
    if (contents !== undefined) {
      const copy = typeof contents === 'string' ? contents : contents.slice()
      this.files.delete(from)
      this.mkdirpSync(dirname(to))
      this.files.set(to, copy)
      return
    }

    // a folder: every entry under it moves by prefix, then the folder records
    const prefix = from + '/'
    const moves: Array<[string, string, Entry]> = []
    for (const [candidate, value] of this.files) {
      if (candidate.startsWith(prefix))
        moves.push([candidate, to + candidate.slice(from.length), value])
    }
    for (const [source] of moves) this.files.delete(source)
    for (const [, destination, value] of moves) {
      this.mkdirpSync(dirname(destination))
      this.files.set(destination, value)
    }
    for (const candidate of [...this.folders]) {
      if (candidate === from || candidate.startsWith(prefix)) {
        this.folders.delete(candidate)
        this.folders.add(to + candidate.slice(from.length))
      }
    }
    this.mkdirpSync(to)
  }
}
