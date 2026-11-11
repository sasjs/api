/**
 * The one program-resolution rule, as the hosts apply it.
 *
 * The cases are the server's, because the server is where the rule came from: an
 * extension that names a run time is used, otherwise each run time the host offers is
 * probed in turn, and a path that leaves the drive is refused exactly as a program
 * that is not there is. What is new is that they are asserted once, over a fake
 * filesystem, rather than in each host's own suite.
 */
import { resolveProgram, type ProgramDeps } from '../src/runtime/program.js'

const deps = (overrides: Partial<ProgramDeps> = {}): ProgramDeps => ({
  resolve: (given) => (given.startsWith('/') ? given : null),
  exists: async () => true,
  runTimes: ['sas', 'js', 'py', 'r'],
  ...overrides
})

/** A refusal, as the corpus compares it. */
const refusal = async (run: Promise<unknown>) => {
  try {
    await run
    return 'resolved'
  } catch (error: any) {
    return { status: error?.status, message: error?.message }
  }
}

describe('resolveProgram', () => {
  it('takes the run time the path names, and looks for that file', async () => {
    const asked: string[] = []

    const resolved = await resolveProgram(
      '/app/run.js',
      deps({
        exists: async (path) => {
          asked.push(path)
          return true
        }
      })
    )

    expect(resolved).toEqual({ path: '/app/run.js', runTime: 'js' })
    // nothing is probed when the name already says
    expect(asked).toEqual(['/app/run.js'])
  })

  it('probes each run time in the host’s order when the path names none', async () => {
    const asked: string[] = []

    const resolved = await resolveProgram(
      '/app/run',
      deps({
        exists: async (path) => {
          asked.push(path)
          return path.endsWith('.py')
        }
      })
    )

    expect(resolved).toEqual({ path: '/app/run.py', runTime: 'py' })
    // in order, and it stops at the first that exists
    expect(asked).toEqual(['/app/run.sas', '/app/run.js', '/app/run.py'])
  })

  it('probes when the extension names no run time', async () => {
    // `run.backup` is a file, not a suffix: the server has always treated it as a
    // path with no run time rather than refusing it outright
    const resolved = await resolveProgram(
      '/app/run.backup',
      deps({ exists: async (path) => path === '/app/run.backup.sas' })
    )

    expect(resolved).toEqual({ path: '/app/run.backup.sas', runTime: 'sas' })
  })

  it('reads the extension below either separator', async () => {
    // the server runs on Windows too, where a resolved path uses backslashes
    const resolved = await resolveProgram(
      'C:\\drive\\app\\run.js',
      deps({ resolve: (given) => given, exists: async () => true })
    )

    expect(resolved).toEqual({ path: 'C:\\drive\\app\\run.js', runTime: 'js' })
  })

  it('refuses a path that leaves the drive, in the same words as one that is missing', async () => {
    expect(
      await refusal(
        resolveProgram(
          '../../outside',
          deps({ resolve: (given) => (given.startsWith('/') ? given : null) })
        )
      )
    ).toEqual({
      status: 400,
      message: 'The Program at (../../outside) does not exist.'
    })
  })

  it('refuses a program that is not on the host at all', async () => {
    expect(
      await refusal(
        resolveProgram('/app/missing', deps({ exists: async () => false }))
      )
    ).toEqual({
      status: 400,
      message: 'The Program at (/app/missing) does not exist.'
    })
  })

  it('does not fall back when the name states a run time that is not there', async () => {
    // `run.py` names the file, so there is nothing to probe: a `run.py.sas` beside
    // it is a different program, and answering with it would run the wrong thing
    expect(
      await refusal(
        resolveProgram(
          '/app/run.py',
          deps({ exists: async (path) => path === '/app/run.py.sas' })
        )
      )
    ).toEqual({
      status: 400,
      message: 'The Program at (/app/run.py) does not exist.'
    })
  })

  it('resolves the run time the name states even where the host cannot run it', async () => {
    // the vocabulary is the document's: `run.py` is Python on a host with no Python,
    // and what that host cannot do is *run* it - it answers that separately (the
    // server's `501`, `resolveProgram`'s callers decide), rather than reading the
    // name as something else
    const resolved = await resolveProgram(
      '/app/run.py',
      deps({ runTimes: ['sas', 'js'], exists: async () => true })
    )

    expect(resolved).toEqual({ path: '/app/run.py', runTime: 'py' })
  })

  it('reads the document’s whole vocabulary, `sasviya` included', async () => {
    // the vocabulary is not the host's list: `run.sasviya` names SAS on Viya even on
    // a host offering only sas and js, and must not be probed as `run.sasviya.sas`
    const resolved = await resolveProgram(
      '/app/run.sasviya',
      deps({ runTimes: ['sas', 'js'], exists: async () => true })
    )

    expect(resolved).toEqual({ path: '/app/run.sasviya', runTime: 'sasviya' })
  })
})
