import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ID = 'GHSA-aaaa-bbbb-cccc'
const SOURCE = 1234567
const severities = ['info', 'low', 'moderate', 'high', 'critical'] as const
type Severity = (typeof severities)[number]

const report = (severity?: Severity) => ({
  auditReportVersion: 2,
  vulnerabilities: severity
    ? {
        example: {
          name: 'example',
          severity,
          isDirect: false,
          via: [
            {
              source: SOURCE,
              name: 'example',
              dependency: 'example',
              title: 'Test advisory',
              url: `https://github.com/advisories/${ID}`,
              severity,
              range: '*'
            }
          ],
          effects: [],
          range: '*',
          nodes: ['node_modules/example'],
          fixAvailable: false
        }
      }
    : {},
  metadata: {
    vulnerabilities: {
      ...Object.fromEntries(severities.map((s) => [s, severity === s ? 1 : 0])),
      total: severity ? 1 : 0
    },
    dependencies: {}
  }
})

const run = (
  full: unknown,
  allowlist: unknown[] = [],
  production?: unknown
) => {
  const dir = mkdtempSync(join(tmpdir(), 'api-audit-'))
  try {
    const input = join(dir, 'full.json')
    const config = join(dir, 'allowlist.json')
    writeFileSync(input, JSON.stringify(full))
    writeFileSync(config, JSON.stringify(allowlist))
    const args = [
      'run',
      'audit:gate',
      '--',
      '--audit-input',
      input,
      '--audit-config',
      config
    ]
    if (production !== undefined) {
      const prod = join(dir, 'prod.json')
      writeFileSync(prod, JSON.stringify(production))
      args.push('--audit-prod-input', prod)
    }
    const result = spawnSync('npm', args, {
      encoding: 'utf8',
      cwd: process.cwd()
    })
    if (result.error) throw result.error
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const waiver = {
  id: ID,
  source: SOURCE,
  severity: 'high',
  packages: ['example'],
  devOnly: true,
  recheckBy: '2099-01-01',
  reason: 'Test waiver'
}

describe('npm run audit:gate', () => {
  it('passes a clean report', () => {
    expect(run(report()).status).toBe(0)
  })

  it.each(['info', 'low', 'moderate', 'high'] as const)(
    'rejects an unwaived %s advisory',
    (severity) => {
      const result = run(report(severity))
      expect(result.status).toBe(1)
      expect(result.output).toContain(`${severity} ${ID} example`)
    }
  )

  it('accepts an exact development-only waiver with a clean production report', () => {
    expect(run(report('high'), [waiver], report()).status).toBe(0)
  })

  it('rejects a different source under the same GHSA', () => {
    const result = run(
      report('high'),
      [{ ...waiver, source: SOURCE + 1 }],
      report()
    )
    expect(result.status).toBe(1)
    expect(result.output).toContain('source differs from allowlist')
  })

  it('rejects a changed severity', () => {
    const result = run(report('moderate'), [waiver], report())
    expect(result.status).toBe(1)
    expect(result.output).toContain('severity differs from allowlist')
  })

  it('requires the numeric source and exact severity on waivers', () => {
    const { source: _source, severity: _severity, ...rest } = waiver
    expect(
      run(report('high'), [{ ...rest, severity: 'high' }], report()).status
    ).toBe(2)
    expect(
      run(report('high'), [{ ...rest, source: SOURCE }], report()).status
    ).toBe(2)
  })

  it('rejects a missing source on the advisory', () => {
    const full = report('high')
    delete (full.vulnerabilities.example!.via[0] as { source?: number }).source
    const result = run(full, [waiver], report())
    expect(result.status).toBe(1)
    expect(result.output).toContain(
      'source differs from allowlist (missing or invalid)'
    )
  })

  it('rejects an unknown advisory severity', () => {
    const full = report('high')
    full.vulnerabilities.example!.via[0].severity = 'unknown' as Severity
    const result = run(full, [waiver], report())
    expect(result.status).toBe(1)
    expect(result.output).toContain('severity differs from allowlist')
  })

  it('rejects an info production finding even when the same source is waived', () => {
    const result = run(report('high'), [waiver], report('info'))
    expect(result.status).toBe(1)
    expect(result.output).toContain(
      `info ${ID} example: in the production tree`
    )
  })

  it('requires a recorded production report for a waiver', () => {
    const result = run(report('high'), [waiver])
    expect(result.status).toBe(2)
    expect(result.output).toContain('needs --audit-prod-input')
  })

  it('rejects a stale waiver', () => {
    const result = run(report(), [waiver], report())
    expect(result.status).toBe(1)
    expect(result.output).toContain('stale=1')
  })

  it('rejects an invalid report', () => {
    const result = run({ error: { code: 'ENOLOCK', summary: 'No lockfile' } })
    expect(result.status).toBe(1)
    expect(result.output).toContain('not an npm audit report')
  })
})
