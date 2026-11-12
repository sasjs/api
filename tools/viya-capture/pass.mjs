/**
 * The scripted passes, separated from the proxy so they can be tested without
 * an estate.
 *
 * `capture.mjs` owns the proxy and the recording; this file owns the calls, and
 * a call's argument order is the part that goes wrong silently. It did: the
 * write step passed the access token into `createFolder`'s `parentFolderPath`,
 * so the request went out with no authorization header, the estate answered
 * `401`, and the adapter's own fallback created nothing - while the step logged
 * `ok`. The fix is an argument list, which is exactly the kind of thing a
 * reader cannot check and a test can.
 *
 * Every function takes a `runStep(name, action)` and a `runCleanup(name, action)`
 * from the caller: the first records a call as part of the contract, the second
 * is for removing what the pass made, and its requests stay out of the table.
 */

/** The name of the throwaway folder a content pass works in. */
export const folderNameFor = (started) => `capture-${started}`

/**
 * The folder family: create one folder under the application, then remove it.
 *
 * `createFolder` takes the new folder's NAME and the parent's PATH as separate
 * arguments. Handing it a full path and a token instead is the mistake above:
 * the token lands in `parentFolderPath`, so the request carries no credential
 * and the estate refuses it.
 */
export const folderPass = async ({
  client,
  token,
  appLoc,
  folderName,
  runStep
}) => {
  const folderPath = `${appLoc}/${folderName}`

  await runStep('folders/create', () =>
    client.createFolder(folderName, appLoc, undefined, token)
  )

  return { folderPath }
}

/** Removes the folder a pass created. Recorded as cleanup, never as contract. */
export const removeFolder = async ({
  client,
  token,
  folderPath,
  runCleanup
}) => {
  await runCleanup('folders/delete', () =>
    client.deleteFolder(folderPath, token)
  )
}

/**
 * The file family: create a file, read it back, replace its content.
 *
 * Deletion is not part of `@sasjs/adapter`'s surface - the client creates, reads
 * and replaces files but never removes one - so the delete that tidies up after
 * this pass runs through the raw request client under `runCleanup`, and its
 * request stays out of the table. The emulator answers what the client calls;
 * a route no client calls is out of scope by decision 3 of the plan.
 */
export const filePass = async ({
  client,
  requestClient,
  token,
  folderPath,
  fileName,
  runStep,
  runCleanup
}) => {
  const initial = 'written by the viya-capture pass\n'
  const replaced = 'replaced by the viya-capture pass\n'
  let created

  await runStep('files/create', async () => {
    created = await client.createFile(
      fileName,
      Buffer.from(initial, 'utf8'),
      folderPath,
      undefined,
      token
    )

    return created
  })

  await runStep('files/content', () =>
    client.getFileContent(folderPath, fileName, token)
  )

  await runStep('files/replace', () =>
    client.updateFileContent(folderPath, fileName, replaced, token)
  )

  if (created?.id)
    await runCleanup('files/cleanup', () =>
      requestClient.delete(`/files/files/${created.id}`, token)
    )

  return { fileId: created?.id }
}
