import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * `npm audit --audit-level=high` ignores the moderate class, so this gate is what
 * refuses a 37th moderate. It is run from CI as `npm run audit:gate`; these cases
 * feed it saved reports so the decisions are pinned without reaching the registry.
 */
const run = (report: unknown): { status: number; output: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-'))
  const path = join(dir, 'report.json')
  writeFileSync(path, JSON.stringify(report))

  try {
    const output = execFileSync(
      process.execPath,
      ['scripts/audit.mjs', '--report', path],
      { encoding: 'utf8' }
    )
    return { status: 0, output }
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string }
    return {
      status: failure.status,
      output: `${failure.stdout}${failure.stderr}`
    }
  }
}

/** The shape `npm audit --json` produces, reduced to what the gate reads. */
const reportWith = (
  via: { source: number; severity: string; title: string }[],
  pkg = 'glob'
) => ({
  vulnerabilities: {
    [pkg]: { severity: 'moderate', via }
  }
})

const GLOB = {
  source: 1244013,
  severity: 'moderate',
  title:
    'Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal'
}
const MINIMATCH = {
  source: 1244623,
  severity: 'moderate',
  title: 'minimatch has potential denial of service via globparts amplification'
}

describe('the advisory gate', () => {
  it('passes when every advisory is allowlisted', () => {
    const { status, output } = run(reportWith([GLOB, MINIMATCH]))

    expect(status).toBe(0)
    expect(output).toContain('2 distinct advisory/advisories, 2 allowlisted')
    expect(output).toContain(
      'no advisory above the floor outside the allowlist'
    )
  })

  it('refuses a moderate that is not allowlisted', () => {
    // the case the whole gate exists for: a 37th moderate must break the build
    const { status, output } = run(
      reportWith([
        GLOB,
        MINIMATCH,
        { source: 9999999, severity: 'moderate', title: 'a new moderate' }
      ])
    )

    expect(status).toBe(1)
    expect(output).toContain('REFUSED moderate: glob 9999999 "a new moderate"')
    expect(output).toContain('add it to scripts/audit-allowlist.json')
  })

  it('refuses a high even when the package is allowlisted for a moderate', () => {
    const { status, output } = run(reportWith([{ ...GLOB, severity: 'high' }]))

    expect(status).toBe(1)
    expect(output).toContain('REFUSED high: glob 1244013')
  })

  it('reports a cleared advisory as stale rather than failing', () => {
    // a list that fails when a fix lands gets deleted instead of maintained
    const { status, output } = run(reportWith([GLOB]))

    expect(status).toBe(0)
    expect(output).toContain('stale: minimatch 1244623')
  })
})
