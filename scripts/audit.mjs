#!/usr/bin/env node
/**
 * The moderate-advisory gate.
 *
 * `npm audit --audit-level=high` catches a high or critical appearing anywhere,
 * but it ignores the whole moderate class, so a 37th moderate ships silently.
 * This gate refuses any advisory at or above a floor unless it is one of the
 * known ones, each carrying the reason it is still open.
 *
 * A cleared advisory is reported as stale rather than as a failure: the tree
 * moves under us, and a list that fails when a fix lands would be deleted rather
 * than kept current.
 *
 * An audit that could not run is neither of those - it is a failure. A report
 * carrying `error` (no lockfile, a registry that refused) has no `vulnerabilities`
 * map at all, so treating it as a result would show a green gate that audited
 * nothing.
 *
 *     node scripts/audit.mjs                     # run npm audit, then judge
 *     node scripts/audit.mjs --report audit.json # judge a saved report
 *
 * Exit 0: nothing above the floor outside the allowlist.
 * Exit 1: an advisory at or above the floor, or one whose severity was raised,
 *         or one waived as dev-only that now reaches the production set.
 * Exit 2: the audit could not run, or did not produce a report.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SEVERITY = ['info', 'low', 'moderate', 'high', 'critical']

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : process.argv[at + 1]
}

/** A report that cannot be judged is not a clean report. */
const readable = (report) => {
  if (report?.error) {
    const { code, summary, detail } = report.error
    throw new Error(
      `npm audit reported an error instead of a result: ${[
        code,
        summary || detail
      ]
        .filter(Boolean)
        .join(' ')}`
    )
  }

  if (!report || !report.metadata || report.auditReportVersion === undefined)
    throw new Error(
      'this is not an npm audit report: no metadata or auditReportVersion'
    )

  return report
}

/**
 * `npm audit --json` exits 1 when it finds something, which is the report we
 * asked for; any other status, or a 1 with nothing parsable, means the audit did
 * not run. stderr is kept so the log says why rather than showing a clean gate.
 *
 * `savedReport` is the path a caller handed in, and `omitDev` asks npm for the
 * production set alone: the two differ only in what is asked for, so the failure
 * handling cannot drift between them.
 */
const auditReport = (savedReport, omitDev = false) => {
  if (savedReport)
    return readable(JSON.parse(readFileSync(savedReport, 'utf8')))

  let stdout = ''
  let stderr = ''
  let status = 0

  const args = ['audit', '--json']
  if (omitDev) args.push('--omit=dev')

  try {
    stdout = execFileSync('npm', args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
  } catch (error) {
    status = error.status
    stdout = error.stdout ? String(error.stdout) : ''
    stderr = error.stderr ? String(error.stderr) : ''

    if (status !== 1 || !stdout.trim())
      throw new Error(
        `npm audit exited ${status} without a report${stderr.trim() ? `:\n${stderr.trim()}` : ''}`
      )
  }

  try {
    return readable(JSON.parse(stdout))
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(
        `npm audit exited ${status} without a parsable report${stderr.trim() ? `:\n${stderr.trim()}` : ''}`
      )
    throw error
  }
}

/**
 * One entry per advisory, not per affected package: npm reports the same
 * advisory once for every package in the tree it reaches, so a single advisory
 * inside a bundled tool arrives under a dozen names, and an allowlist keyed by
 * package would carry twelve copies of one reason.
 */
const advisoriesIn = (report) => {
  const seen = new Map()
  for (const [name, vulnerable] of Object.entries(report.vulnerabilities || {}))
    for (const via of vulnerable.via || [])
      if (typeof via === 'object' && via.source !== undefined)
        seen.set(`${via.source}`, {
          source: via.source,
          package: name,
          severity: via.severity,
          title: via.title
        })
  return [...seen.values()]
}

const main = () => {
  const allowlistPath = arg('allowlist', join(here, 'audit-allowlist.json'))
  const floor = arg('floor', 'low')
  if (!SEVERITY.includes(floor))
    throw new Error(`--floor must be one of ${SEVERITY.join(', ')}`)

  const report = auditReport(arg('report'))
  const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'))
  const advisories = advisoriesIn(report)
  const allowed = new Map(allowlist.map((entry) => [`${entry.source}`, entry]))
  const atOrAbove = (entry) =>
    SEVERITY.indexOf(entry.severity) >= SEVERITY.indexOf(floor)

  // The severity is part of the match: an advisory we carry as a moderate that is
  // re-rated as a high is news, not something the old reason still covers.
  const refused = advisories.filter((a) => {
    const entry = allowed.get(`${a.source}`)
    return atOrAbove(a) && (!entry || entry.severity !== a.severity)
  })
  const stale = allowlist.filter(
    (entry) => !advisories.some((a) => `${a.source}` === `${entry.source}`)
  )

  /**
   * A `devOnly` waiver says the package cannot reach what ships - that it arrives
   * through the test and build tooling alone. Matching is by advisory id over the
   * whole tree, so that sentence would go on waiving the advisory after a
   * production dependency pulled the same package in; the claim is therefore
   * measured rather than written down. An id that appears in the production set
   * fails the gate, and the reason has to be replaced with one that accounts for
   * the exposure.
   *
   * The second report is asked for only when the allowlist carries such an entry,
   * so a tree without one pays nothing for the check. In saved-report mode it has
   * to be handed in: an unverified waiver is a green gate that checked less than
   * it says, which is the failure mode this script exists to avoid.
   */
  const devOnly = allowlist.filter((entry) => entry.devOnly)
  let shipped = []
  if (devOnly.length) {
    const production = arg('production-report')
    if (arg('report') && !production)
      throw new Error(
        'a dev-only waiver needs --production-report, or it is a claim nothing checks'
      )
    shipped = advisoriesIn(auditReport(production, true))
  }

  const reachedProduction = devOnly.filter((entry) =>
    shipped.some((a) => `${a.source}` === `${entry.source}`)
  )

  console.log(
    `${advisories.length} distinct advisory/advisories, ${allowlist.length} allowlisted, floor ${floor}`
  )
  for (const entry of stale)
    console.log(
      `  stale: ${entry.package} ${entry.source} "${entry.title}" - ${entry.reason}`
    )
  for (const entry of devOnly)
    if (!reachedProduction.includes(entry))
      console.log(
        `  waived as dev-only: ${entry.source} ${entry.package} - not in the production set`
      )

  if (reachedProduction.length) {
    for (const entry of reachedProduction)
      console.log(
        `  REFUSED ${entry.severity}: ${entry.package} ${entry.source} was waived as dev-only, but it now reaches a production dependency`
      )
    console.log(
      'Fix it, or give it a reason that accounts for production exposure.'
    )
    process.exit(1)
  }

  if (refused.length) {
    for (const entry of refused)
      console.log(
        `  REFUSED ${entry.severity}: ${entry.package} ${entry.source} "${entry.title}"`
      )
    console.log(
      'A new advisory at or above the floor. Fix it, or add it to scripts/audit-allowlist.json with the reason it cannot be fixed.'
    )
    process.exit(1)
  }

  console.log('no advisory above the floor outside the allowlist')
}

try {
  main()
} catch (error) {
  console.error(`audit gate could not run: ${error.message}`)
  process.exit(2)
}
