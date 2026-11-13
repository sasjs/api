import { LintConfig } from '@sasjs/lint'

import { LintConfig as exportedLintConfig } from '../src/code/index.js'
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

  it('refuses a body with no code, and one with an empty code', async () => {
    // the two refusals the schema makes, and the two different bugs behind them
    await expect(service.lint(caller, {} as any)).rejects.toMatchObject({
      status: 400,
      message: '"code" is required'
    })

    await expect(service.lint(caller, { code: '' })).rejects.toMatchObject({
      status: 400,
      message: '"code" is not allowed to be empty'
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

  /**
   * A host that keeps its rules in a store it reads asynchronously answers with
   * a promise - the browser host over its drive is the one that does - and the
   * routes have to wait for it: a resolver whose answer was ignored would lint
   * every file against the defaults while the host reported rules per folder.
   *
   * The two rules below are far apart on purpose (10 against the default 80),
   * so the finding names the configuration that actually arrived rather than
   * one both would produce.
   */
  it('waits for a host that resolves the rules asynchronously', async () => {
    const configured = createCodeService({
      lintConfig: async (filePath) => {
        await Promise.resolve()
        return filePath === '/projects/app/run.sas'
          ? new LintConfig({ maxLineLength: 10 })
          : undefined
      }
    })

    const diagnostics = await configured.lint(caller, {
      code: 'data _null_;\n  x = 1;\nrun;\n',
      filePath: '/projects/app/run.sas'
    })

    expect(
      diagnostics.some((diagnostic) =>
        diagnostic.message.startsWith('Line exceeds maximum length')
      )
    ).toBe(true)

    // and the same buffer elsewhere on the drive still gets the defaults
    const elsewhere = await configured.lint(caller, {
      code: 'data _null_;\n  x = 1;\nrun;\n',
      filePath: '/other/run.sas'
    })

    expect(
      elsewhere.some((diagnostic) =>
        diagnostic.message.startsWith('Line exceeds maximum length')
      )
    ).toBe(false)
  })

  /**
   * The entry a host imports when it resolves rules from its own storage: what it
   * builds has to be the class the routes hand the linter, and this pins that the
   * entry re-exports the one this package depends on rather than a look-alike.
   * It cannot see a second copy in a consumer's own tree - nothing in this repo
   * can - so it does not claim to.
   */
  it('exports the configuration class the routes hand the linter', () => {
    expect(exportedLintConfig).toBe(LintConfig)
  })

  it('formats with the rules an asynchronous host resolved', async () => {
    const configured = createCodeService({
      lintConfig: () =>
        Promise.resolve(
          new LintConfig({
            hasDoxygenHeader: true,
            defaultHeader: '/**\n  @brief the awaited header\n**/'
          })
        )
    })

    const formatted = await configured.format(caller, {
      code: 'data _null_;\nrun;\n',
      filePath: '/projects/app/run.sas'
    })

    expect(formatted).toContain('@brief the awaited header')
  })
})
