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
 *
 * `runStep` swallows a refusal and returns undefined, so a step that hands its
 * result to the next step has to check it. Doing that is the difference between
 * "the folder was created" and "a 201 was recorded somewhere" - and the defect
 * above was exactly a silent failure that still logged `ok`.
 */

/** The name of the throwaway folder a content pass works in. */
export const folderNameFor = (started) => `capture-${started}`

/**
 * The folder family: create one folder under the application.
 *
 * `createFolder` takes the new folder's NAME and the parent's PATH as separate
 * arguments. Handing it a full path and a token instead is the mistake above:
 * the token lands in `parentFolderPath`, so the request carries no credential
 * and the estate refuses it.
 *
 * `created` says whether the estate answered with a folder. A caller that
 * ignores it writes file steps, and their 404s, into the folder the run never
 * made.
 */
export const folderPass = async ({
  client,
  token,
  appLoc,
  folderName,
  runStep
}) => {
  const folderPath = `${appLoc}/${folderName}`

  const created = await runStep('folders/create', () =>
    client.createFolder(folderName, appLoc, undefined, token)
  )

  return { folderPath, created: Boolean(created) }
}

/**
 * Removes the folder a pass created.
 *
 * A recorded step, not a cleanup: `deleteFolder` is a public
 * `SASViyaApiClient` method, so a client does call it and the emulator has to
 * answer what it sends - the `GET /folders/folders/@myRecycleBin` and the
 * `PATCH` that moves the folder there. The only delete in this tool that is
 * outside the adapter's surface is the file one, in `filePass`.
 */
export const removeFolder = async ({ client, token, folderPath, runStep }) => {
  await runStep('folders/delete', () => client.deleteFolder(folderPath, token))
}

/**
 * The execution family: one script through the compute API, with the log.
 *
 * `debug` is on because the log is half the contract - a caller reads it to
 * find out what the program said. `%put &=sysvlong;` is the line this pass
 * produces beyond the request shapes: it names the version the capture
 * describes, which is what `VIYA_TARGET_VERSION` is pinned to.
 *
 * With `expectWebout` false the adapter returns `{ job, log }` before its own
 * `clearSession`, so the session it opened is still running. The job's `up`
 * link names it, and the pass removes it: a recorder that leaves a compute
 * session behind on someone's estate is not a read-only tool with an opt-in
 * extra step, it is a leak.
 */
export const executePass = async ({
  client,
  requestClient,
  authConfig,
  contextName,
  runStep,
  runCleanup
}) => {
  // the refresh the adapter performs rotates the pair, so the token that opened
  // the session is not necessarily the one that closes it
  let token = authConfig?.access_token

  const result = await runStep('compute/execute-script', () =>
    client.executeScript(
      'capture',
      ['%put &=sysvlong;'],
      contextName,
      authConfig,
      null,
      true,
      false,
      true,
      undefined,
      false,
      undefined,
      (refreshed) => {
        token = refreshed.access_token
      }
    )
  )

  const sessionUri = result?.job?.links?.find((link) => link.rel === 'up')?.href

  if (sessionUri)
    await runCleanup('compute/session-cleanup', () =>
      requestClient.delete(sessionUri, token)
    )

  return result
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

/**
 * The whole content family, in the order the estate allows.
 *
 * A refused folder create ends the pass. Continuing would run the file steps
 * against a folder that does not exist, and their 404s would be recorded as
 * contract rows describing a folder nobody made - the same class of quiet
 * wrongness as the defect at the top of this file.
 *
 * The folder is removed after the file inside it, because the estate refuses to
 * delete a folder that still has members (11516) and offers no recursive
 * delete.
 */
export const contentPass = async ({
  client,
  requestClient,
  token,
  appLoc,
  folderName,
  allowFiles,
  runStep,
  runCleanup
}) => {
  const { folderPath, created } = await folderPass({
    client,
    token,
    appLoc,
    folderName,
    runStep
  })

  if (!created) return { folderPath, created: false, fileId: undefined }

  const { fileId } = allowFiles
    ? await filePass({
        client,
        requestClient,
        token,
        folderPath,
        fileName: `${folderName}.txt`,
        runStep,
        runCleanup
      })
    : {}

  await removeFolder({ client, token, folderPath, runStep })

  return { folderPath, created: true, fileId }
}
