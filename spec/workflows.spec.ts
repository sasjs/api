import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { parse } from 'yaml'

/**
 * Every workflow file parses, and every file that parses has jobs.
 *
 * A workflow with a YAML error does not fail usefully: GitHub starts a run with
 * no jobs, the run is reported red, and the pull request that introduced it shows
 * no checks at all - so the mistake reads as "nothing to run" rather than "this
 * file is broken". That happened on this branch: a step named with a colon inside
 * it made the file invalid, prettier accepted it, and the only signal was a run
 * named after the file's path.
 */
const workflows = join(__dirname, '..', '.github', 'workflows')

const files = readdirSync(workflows).filter((file) => /\.ya?ml$/.test(file))

describe('the workflows', () => {
  it('finds the workflow files', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files)
    it(`${file} parses, and declares jobs with steps`, () => {
      const document = parse(readFileSync(join(workflows, file), 'utf8'))

      expect(document).toBeTruthy()
      expect(Object.keys(document.jobs ?? {}).length).toBeGreaterThan(0)

      for (const job of Object.values<any>(document.jobs))
        // a reusable-workflow job has `uses` instead of steps
        expect(Boolean(job.steps) || Boolean(job.uses)).toBe(true)

      // a step name is a plain scalar: a second colon makes the file invalid
      for (const job of Object.values<any>(document.jobs))
        for (const step of job.steps ?? [])
          expect(typeof (step.name ?? step.uses)).toBe('string')
    })
})
