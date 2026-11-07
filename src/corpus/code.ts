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
