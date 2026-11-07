import { createCodeService } from '../src/code/service.js'

/**
 * The service's own edges: a caller, a body, and the rules a host supplies.
 *
 * The corpus pins what the two routes answer; these pin the branches a corpus
 * case cannot reach, which is what keeps the coverage floor honest now that the
 * linter is a dependency rather than a host's own code.
 */
const caller = { userId: 'user-admin', clientId: 'web_app' }

describe('the code service', () => {
  const service = createCodeService()

  it('refuses a request with no caller', async () => {
    await expect(
      service.lint(undefined, { code: 'data _null_; run;' })
    ).rejects.toMatchObject({ status: 401, message: 'Unauthorized' })

    await expect(
      service.format(undefined, { code: 'data _null_; run;' })
    ).rejects.toMatchObject({ status: 401, message: 'Unauthorized' })
  })

  it('refuses a body with no code', async () => {
    await expect(service.lint(caller, { code: '' })).rejects.toMatchObject({
      status: 400,
      message: '"code" is required'
    })
  })

  it('asks the host which file the rules come from', async () => {
    const asked: (string | undefined)[] = []
    const configured = createCodeService({
      lintConfig: (filePath) => {
        asked.push(filePath)
        return undefined
      }
    })

    await configured.format(caller, {
      code: 'data _null_;\nrun;\n',
      filePath: '/projects/app/run.sas'
    })

    expect(asked).toEqual(['/projects/app/run.sas'])
  })
})
