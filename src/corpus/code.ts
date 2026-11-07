import type { CorpusCase } from './drive.js'

/**
 * The editor's corpus: the two routes that answer about a buffer rather than a
 * file.
 *
 * Both expectations are the linter's own output for the same input, measured
 * against `@sasjs/lint` with no configuration - the defaults an untitled buffer
 * lints against. A host that supplies a `.sasjslint` changes the rules for its
 * own drive, which is why the case names no `filePath`.
 *
 *     lintText('data _null_;\n  x = 1;\nrun;\n')
 *       -> [{ message: 'File missing Doxygen header', lineNumber: 1, ... }]
 *     formatText(...)
 *       -> the header block, then the program with its spacing normalised
 */
export const CODE_CORPUS: CorpusCase[] = [
  {
    id: 'code-lint-missing-header',
    route: 'POST /SASjsApi/code/lint',
    description:
      'answers the diagnostics for a buffer, without touching a file',
    request: {
      // the routes are permissioned; the runner resolves the fixture's admin
      subject: { userId: 'user-admin', clientId: 'web_app' },
      body: { code: 'data _null_;\n  x = 1;\nrun;\n' }
    },
    expect: {
      status: 200,
      body: [
        {
          message: 'File missing Doxygen header',
          lineNumber: 1,
          startColumnNumber: 1,
          endColumnNumber: 1,
          severity: 1
        }
      ]
    }
  },
  {
    id: 'code-lint-unauthenticated',
    route: 'POST /SASjsApi/code/lint',
    description: 'refuses a caller with no token',
    request: { body: { code: 'data _null_; run;' } },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'code-lint-non-string',
    route: 'POST /SASjsApi/code/lint',
    description:
      'refuses a code value that is not a string, rather than coercing it',
    request: {
      subject: { userId: 'user-admin', clientId: 'web_app' },
      body: { code: 123 }
    },
    expect: { status: 400, error: '"code" must be a string' }
  },
  {
    id: 'code-lint-empty',
    route: 'POST /SASjsApi/code/lint',
    description:
      'refuses an empty buffer, which is not the same as a missing one',
    request: {
      subject: { userId: 'user-admin', clientId: 'web_app' },
      body: { code: '' }
    },
    expect: { status: 400, error: '"code" is not allowed to be empty' }
  },
  {
    id: 'code-format-unauthenticated',
    route: 'POST /SASjsApi/code/format',
    description: 'refuses a caller with no token',
    request: { body: { code: 'data _null_; run;' } },
    expect: { status: 401, error: 'Unauthorized' }
  },
  {
    id: 'code-format-non-string',
    route: 'POST /SASjsApi/code/format',
    description: 'refuses a code value that is not a string',
    request: {
      subject: { userId: 'user-admin', clientId: 'web_app' },
      body: { code: 123 }
    },
    expect: { status: 400, error: '"code" must be a string' }
  },
  {
    id: 'code-format-adds-the-header',
    route: 'POST /SASjsApi/code/format',
    description: 'answers the formatted buffer, header block included',
    request: {
      // the routes are permissioned; the runner resolves the fixture's admin
      subject: { userId: 'user-admin', clientId: 'web_app' },
      body: { code: 'data _null_;\n  x = 1;\nrun;\n' }
    },
    expect: {
      status: 200,
      body: '/**\n  @file\n  @brief <Your brief here>\n\n  <h4> SAS Macros </h4>\n\n**/\ndata _null_;\n  x = 1;\nrun;\n'
    }
  }
]
