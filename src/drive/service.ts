/**
 * The drive, as behaviour rather than storage.
 *
 * Every function here is the same decision a SASjs Server makes today - the
 * status, the message, the order of the checks - with the bytes left to a
 * `DriveStore` the host supplies. The server passes a store over node's fs; the
 * browser build passes one over its in-memory drive. Neither re-implements the
 * rules, which is how the two drifted apart before (sasjs/cli#1542).
 *
 * The functions are `async` even though both current stores are synchronous, so
 * that an async backend later is a store change rather than a signature change
 * in every consumer.
 */
import type { DriveStore, TreeNode } from '../types.js'
import { ApiError } from '../types.js'
import { deployTree } from './deploy.js'
import {
  basename,
  checkFilePath,
  dirname,
  hasBlockedExtension,
  isRoot,
  normaliseDrivePath
} from './paths.js'

export interface DriveResult {
  status: 'success'
}

export interface DriveListing {
  files: string[]
  folders: string[]
}

export interface DriveFile {
  contents: string | Uint8Array
  binary: boolean
}

export interface DriveTree {
  status: 'success'
  tree: TreeNode
}

export interface DriveService {
  list(folderPath?: string): Promise<DriveListing>
  read(filePath: string): Promise<DriveFile>
  save(filePath: string, contents: string | Uint8Array): Promise<DriveResult>
  update(filePath: string, contents: string | Uint8Array): Promise<DriveResult>
  remove(filePath: string): Promise<DriveResult>
  mkdir(folderPath: string): Promise<DriveResult>
  rmdir(folderPath: string): Promise<DriveResult>
  rename(oldPath: string, newPath: string): Promise<DriveResult>
  tree(folderPath?: string): Promise<DriveTree>
  /**
   * Writes a whole tree under `appLoc`, or refuses without writing.
   *
   * `tree` is `unknown` on purpose: the wire payload is the caller's JSON, and
   * the shape is one of the things this decides - a mistyped tree earns the
   * routes' `400` rather than a crash in a host that trusted it.
   */
  deploy(appLoc: string, tree: unknown): Promise<DriveResult>
}

/** A path a file operation may act on, or the refusal the operation answers. */
const filePath = (input: unknown, outside: string): string => {
  const checked = checkFilePath(input)
  if ('reason' in checked) {
    throw checked.reason === 'extension'
      ? new ApiError(400, 'Invalid file extension')
      : new ApiError(400, outside)
  }
  if (isRoot(checked.path)) throw new ApiError(400, outside)
  return checked.path
}

/** A folder path, which may be the drive root but never an extension check. */
const folderPath = (input: unknown, outside: string): string => {
  const path = normaliseDrivePath(input)
  if (path === null) throw new ApiError(400, outside)
  return path
}

export const createDriveService = (store: DriveStore): DriveService => {
  const treeOf = async (path: string): Promise<TreeNode> => {
    const listing = await store.list(path)
    const children: TreeNode[] = []
    for (const folder of listing.folders) {
      children.push(
        await treeOf(path === '/' ? '/' + folder : path + '/' + folder)
      )
    }
    for (const file of listing.files) {
      const relativePath = path === '/' ? '/' + file : path + '/' + file
      // One stat per file: the dates a client sorts or shows are the host's,
      // and a store that reports none simply omits them.
      const stat = await store.stat(relativePath)

      children.push({
        name: file,
        relativePath,
        isFolder: false,
        ...(stat.modified ? { modified: stat.modified } : {}),
        ...(stat.created ? { created: stat.created } : {}),
        children: []
      })
    }
    return {
      name: path === '/' ? 'files' : basename(path),
      relativePath: path,
      isFolder: true,
      children
    }
  }

  return {
    async list(given) {
      // an empty path is the root, which is what the server's GET /folder does
      // with no `_folderPath`
      const path = folderPath(
        given === undefined ? '' : given,
        "Can't get folder outside drive."
      )
      if (!(await store.exists(path)))
        throw new ApiError(404, `Folder doesn't exist.`)
      const stat = await store.stat(path)
      if (!stat.directory) throw new ApiError(400, 'Not a Folder.')
      const listing = await store.list(path)
      return {
        files: [...listing.files].sort(),
        folders: [...listing.folders].sort()
      }
    },

    async read(given) {
      const path = filePath(given, "Can't get file outside drive.")
      if (!(await store.exists(path)))
        throw new ApiError(404, `File doesn't exist.`)
      const contents = await store.read(path)
      return { contents, binary: typeof contents !== 'string' }
    },

    async save(given, contents) {
      const path = filePath(given, "Can't put file outside drive.")
      if (await store.exists(path))
        throw new ApiError(409, 'File already exists.')
      await store.mkdirp(dirname(path))
      await store.write(path, contents)
      return { status: 'success' }
    },

    async update(given, contents) {
      const path = filePath(given, "Can't modify file outside drive.")
      if (!(await store.exists(path)))
        throw new ApiError(404, `File doesn't exist.`)
      await store.write(path, contents)
      return { status: 'success' }
    },

    async remove(given) {
      const path = filePath(given, "Can't delete file outside drive.")
      if (!(await store.exists(path)))
        throw new ApiError(404, `File doesn't exist.`)
      await store.remove(path)
      return { status: 'success' }
    },

    async mkdir(given) {
      const path = folderPath(given, "Can't put folder outside drive.")
      if (isRoot(path))
        throw new ApiError(400, "Can't put folder outside drive.")
      if (await store.exists(path))
        throw new ApiError(409, 'Folder already exists.')
      await store.mkdirp(path)
      return { status: 'success' }
    },

    async rmdir(given) {
      const path = folderPath(given, "Can't delete folder outside drive.")
      // the root is the whole drive: refused here as well as at validation,
      // because a caller reaching this function directly has no validation
      if (isRoot(path))
        throw new ApiError(400, "Can't delete folder outside drive.")
      if (!(await store.exists(path)) || !(await store.stat(path)).directory)
        throw new ApiError(404, `Folder doesn't exist.`)
      await store.remove(path)
      return { status: 'success' }
    },

    async rename(oldPath, newPath) {
      const from = folderPath(oldPath, "Old path can't be outside of drive.")
      const to = folderPath(newPath, "New path can't be outside of drive.")
      if (isRoot(from) || isRoot(to))
        throw new ApiError(400, "New path can't be outside of drive.")

      if (await store.exists(from)) {
        const stat = await store.stat(from)
        // a folder moved inside itself would be an infinite copy, and the
        // server loses this at the filesystem with an opaque error
        if (stat.directory && (to === from || to.startsWith(from + '/')))
          throw new ApiError(
            400,
            "New path can't be inside the folder being moved."
          )
        if (await store.exists(to))
          throw new ApiError(
            409,
            stat.directory
              ? 'Folder with new name already exists.'
              : 'File with new name already exists.'
          )
        // the extension rule is the drive's file-path rule, so a rename may not
        // be the way around it: without this a file could be renamed into a name
        // that GET, PATCH and DELETE then refuse, leaving an entry the API that
        // created it can no longer read or remove. A folder is not subject to it
        // (nothing puts a folder through the file-path schema), so only a file
        // move is checked.
        if (!stat.directory && hasBlockedExtension(to))
          throw new ApiError(400, 'Invalid file extension')
        await store.move(from, to)
        return { status: 'success' }
      }

      throw new ApiError(404, 'No file/folder found for provided path.')
    },

    async tree(given) {
      const path = folderPath(
        given === undefined ? '' : given,
        "Can't get folder outside drive."
      )
      if (!(await store.exists(path)))
        throw new ApiError(404, `Folder doesn't exist.`)
      const stat = await store.stat(path)
      if (!stat.directory) throw new ApiError(400, 'Not a Folder.')
      return { status: 'success', tree: await treeOf(path) }
    },

    async deploy(appLoc, tree) {
      await deployTree(store, appLoc, tree)

      return { status: 'success' }
    }
  }
}
