import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * `npm audit --audit-level=high` ignores the moderate class, so this gate is what
 * refuses a 37th moderate. It is run from CI as `npm run audit:gate`; these cases
 * feed it a saved report and an allowlist of their own, so the decisions are
 * pinned without reaching the registry and without depending on what the
 * repository's allowlist carries.
 */
const run = (
  report: unknown,
  allowlist: unknown[] = ENTRIES,
  production?: unknown
): { status: number; output: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-'))
  const path = join(dir, 'report.json')
  const list = join(dir, 'allowlist.json')
  writeFileSync(path, JSON.stringify(report))
  writeFileSync(list, JSON.stringify(allowlist))

  const args = ['scripts/audit.mjs', '--report', path, '--allowlist', list]

  if (production !== undefined) {
    const shipped = join(dir, 'production.json')
    writeFileSync(shipped, JSON.stringify(production))
    args.push('--production-report', shipped)
  }

  try {
    const output = execFileSync(process.execPath, args, { encoding: 'utf8' })
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
  auditReportVersion: 2,
  metadata: {
    vulnerabilities: { moderate: via.length, total: via.length }
  },
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

/** An allowlist carrying both, so the cases can be about the decision and not the list. */
const ENTRIES = [
  { ...GLOB, package: 'glob', reason: 'test fixture' },
  { ...MINIMATCH, package: 'minimatch', reason: 'test fixture' }
]

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

describe('a waiver that says the advisory cannot reach what ships', () => {
  const PICOMATCH = {
    source: 1247710,
    severity: 'high',
    title:
      'picomatch vulnerable to ReDoS through single-branch repeated extglobs'
  }

  const waiver = [
    {
      ...PICOMATCH,
      package: 'picomatch',
      devOnly: true,
      reason: 'test fixture'
    }
  ]

  const productionWith = (advisory?: typeof PICOMATCH) =>
    reportWith(advisory ? [advisory] : [], 'picomatch')

  it('passes when the production set does not carry the waived advisory', () => {
    const { status, output } = run(
      reportWith([PICOMATCH], 'picomatch'),
      waiver,
      productionWith()
    )

    expect(status).toBe(0)
    expect(output).toContain(
      'waived as dev-only: 1247710 picomatch - not in the production set'
    )
  })

  it('refuses a dev-only waiver whose advisory now reaches a production dependency', () => {
    // matching is by advisory id over the whole tree, so the reason would go on
    // waiving it after a shipped dependency pulled the same package in
    const { status, output } = run(
      reportWith([PICOMATCH], 'picomatch'),
      waiver,
      productionWith(PICOMATCH)
    )

    expect(status).toBe(1)
    expect(output).toContain(
      'REFUSED high: picomatch 1247710 was waived as dev-only, but it now reaches a production dependency'
    )
  })

  it('refuses to leave the claim unverified when no production report is given', () => {
    // a saved-report run that skipped the second audit would be a green gate
    // that checked less than the entry says it did
    const { status, output } = run(reportWith([PICOMATCH], 'picomatch'), waiver)

    expect(status).toBe(2)
    expect(output).toContain('a dev-only waiver needs --production-report')
  })

  it('asks for no second audit when no entry claims to be dev-only', () => {
    const { status, output } = run(reportWith([GLOB]), ENTRIES)

    expect(status).toBe(0)
    expect(output).not.toContain('waived as dev-only')
  })
})

describe('the advisory gate, when the audit did not run', () => {
  it('fails rather than passing on a report that carries an error', () => {
    // `npm audit` with no lockfile answers {"error":{"code":"ENOLOCK",...}} and
    // no vulnerabilities map, which used to print a clean gate that audited
    // nothing
    const { status, output } = run({
      error: {
        code: 'ENOLOCK',
        summary: 'This command requires an existing lockfile.'
      }
    })

    expect(status).toBe(2)
    expect(output).toContain('audit gate could not run')
    expect(output).toContain('ENOLOCK')
  })

  it('fails on a report that is not an audit result', () => {
    const { status, output } = run({ vulnerabilities: {} })

    expect(status).toBe(2)
    expect(output).toContain('no metadata or auditReportVersion')
  })

  it('treats a registry failure as a failure, not as a clean tree', () => {
    const { status, output } = run({
      error: { summary: 'registry returned 503' }
    })

    expect(status).toBe(2)
    expect(output).toContain('registry returned 503')
  })
})
