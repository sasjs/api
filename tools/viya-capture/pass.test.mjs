import test from 'node:test'
import assert from 'node:assert/strict'
import {
  executePass,
  filePass,
  folderNameFor,
  folderPass,
  removeFolder
} from './pass.mjs'

/**
 * A stand-in for the adapter's client that records how it was called.
 *
 * The argument ORDER is what this file exists for: `createFolder` takes
 * `(name, parentPath, parentUri, token)`, and a call that hands it a full path
 * and a token instead puts the token in `parentFolderPath` - so the request
 * carries no `Authorization` header, the estate answers 401, and the step still
 * prints `ok`, because nothing was thrown.
 */
const fakeClient = (overrides = {}) => {
  const calls = []

  const record =
    (name) =>
    async (...args) => {
      calls.push({ name, args })

      return overrides[name] ? overrides[name](...args) : { id: `${name}-id` }
    }

  return {
    calls,
    client: {
      createFolder: record('createFolder'),
      deleteFolder: record('deleteFolder'),
      createFile: record('createFile'),
      getFileContent: record('getFileContent'),
      updateFileContent: record('updateFileContent'),
      executeScript: record('executeScript')
    }
  }
}

const recorder = () => {
  const steps = []
  const cleanups = []

  return {
    steps,
    cleanups,
    // the real runStep swallows a refusal and records it, because a 401 or a 403
    // is part of the contract - a stand-in that rethrew would test a different
    // caller from the one in capture.mjs
    runStep: async (name, action) => {
      steps.push(name)

      try {
        return await action()
      } catch {
        return undefined
      }
    },
    runCleanup: async (name, action) => {
      cleanups.push(name)

      return action()
    }
  }
}

test('the content folder is created with the name and the parent apart', async () => {
  const { client, calls } = fakeClient()
  const { runStep } = recorder()
  const appLoc = '/Public/app'
  const folderName = folderNameFor(1234)

  const { folderPath } = await folderPass({
    client,
    token: 'the-token',
    appLoc,
    folderName,
    runStep
  })

  assert.equal(folderPath, `${appLoc}/${folderName}`)
  assert.deepEqual(
    calls[0].args,
    [folderName, appLoc, undefined, 'the-token'],
    'createFolder takes (name, parentPath, parentUri, token) - a full path or a token in the second slot sends an unauthenticated request'
  )
})

test('a folder is removed through cleanup, so its delete stays out of the table', async () => {
  const { client, calls } = fakeClient()
  const { cleanups, runStep } = recorder()

  await removeFolder({
    client,
    token: 'the-token',
    folderPath: '/Public/app/capture-1',
    runCleanup: async (name, action) => {
      cleanups.push(name)

      return action()
    }
  })

  assert.deepEqual(cleanups, ['folders/delete'])
  assert.deepEqual(calls[0].args, ['/Public/app/capture-1', 'the-token'])
})

test('the file family creates, reads and replaces, in that order', async () => {
  const { client, calls } = fakeClient()
  const { runStep, runCleanup } = recorder()

  await filePass({
    client,
    requestClient: { delete: async () => ({}) },
    token: 'the-token',
    folderPath: '/Public/app/capture-1',
    fileName: 'capture-1.txt',
    runStep,
    runCleanup
  })

  assert.deepEqual(
    calls.map((call) => call.name),
    ['createFile', 'getFileContent', 'updateFileContent']
  )
  assert.deepEqual(calls[0].args.slice(0, 2), [
    'capture-1.txt',
    Buffer.from('written by the viya-capture pass\n', 'utf8')
  ])
  assert.equal(calls[0].args[2], '/Public/app/capture-1')
  assert.equal(
    calls[1].args.length,
    3,
    'getFileContent takes (folderPath, fileName, token)'
  )
})

test('a refused read still deletes the file it created', async () => {
  const { client } = fakeClient({
    getFileContent: async () => {
      throw new Error('403')
    }
  })
  const { runStep, runCleanup } = recorder()
  const deleted = []

  await filePass({
    client,
    requestClient: {
      delete: async (uri) => {
        deleted.push(uri)

        return {}
      }
    },
    token: 'the-token',
    folderPath: '/Public/app/capture-1',
    fileName: 'capture-1.txt',
    runStep,
    runCleanup
  })

  assert.deepEqual(deleted, ['/files/files/createFile-id'])
})

test('the file delete is a cleanup, never a captured step', async () => {
  const { client } = fakeClient()
  const { cleanups, steps, runStep, runCleanup } = recorder()

  await filePass({
    client,
    requestClient: { delete: async () => ({}) },
    token: 'the-token',
    folderPath: '/Public/app/capture-1',
    fileName: 'capture-1.txt',
    runStep,
    runCleanup
  })

  assert.deepEqual(cleanups, ['files/cleanup'])
  assert.deepEqual(steps, ['files/create', 'files/content', 'files/replace'])
})

test('the execute family hands the adapter an auth config, not a bare token', async () => {
  const { client, calls } = fakeClient({
    executeScript: async () => ({ log: 'SYSVLONG=V.04.00M0P100526' })
  })
  const { runStep } = recorder()
  const authConfig = { access_token: 'a', refresh_token: 'b' }

  const result = await executePass({
    client,
    authConfig,
    contextName: 'Compute Reusable',
    runStep
  })

  assert.equal(calls[0].name, 'executeScript')
  // the fourth argument is the AuthConfig: a bare token in that slot is not an
  // object the adapter reads, and the job goes out unauthenticated
  assert.equal(calls[0].args[3], authConfig)
  assert.equal(calls[0].args[2], 'Compute Reusable')
  assert.equal(calls[0].args[5], true, 'debug on, so the log comes back')
  assert.equal(result.log.includes('SYSVLONG'), true)
})
