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
 *     node scripts/audit.mjs                     # run npm audit, then judge
 *     node scripts/audit.mjs --report audit.json # judge a saved report
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

const allowlistPath = arg('allowlist', join(here, 'audit-allowlist.json'))
const floor = arg('floor', 'moderate')
if (!SEVERITY.includes(floor))
  throw new Error(`--floor must be one of ${SEVERITY.join(', ')}`)

/** `npm audit --json` exits 1 when anything is found, which is not an error. */
const auditReport = () => {
  const report = arg('report')
  if (report) return JSON.parse(readFileSync(report, 'utf8'))

  const json = execFileSync(
    'sh',
    ['-c', 'npm audit --json 2>/dev/null || true'],
    {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    }
  )
  return JSON.parse(json)
}

/**
 * One entry per advisory, not per affected package: npm reports the same
 * advisory once for every package in the tree it reaches, and glob and minimatch
 * between them account for all 36 of the moderates today.
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

const report = auditReport()
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

console.log(
  `${advisories.length} distinct advisory/advisories, ${allowlist.length} allowlisted, floor ${floor}`
)
for (const entry of stale)
  console.log(
    `  stale: ${entry.package} ${entry.source} "${entry.title}" - ${entry.reason}`
  )

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
